import { expect, it, vi } from 'vitest'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { actions } from '../index'

type Data = Record<string, unknown>
const ok = (data: unknown) => ({ success: true, data })
const missing = { success: false, error: 'Record not found' }
const failure = { success: false, error: 'private backend detail' }
const track = { title: ' Song ', artist: ' DJ ' }
const stored = { title: 'Song', artist: 'DJ', roomId: 'room', addedBy: 'bob' }
function fixture() {
  const tracks = new Map<string, Data>()
  const room = { roomId: 'room', trackOrder: [] as string[], ownerId: 'bob' }
  const member = { recordId: 'member', data: { teamId: 'room', userId: 'alice', status: 'active' } }
  const get = vi.fn(async (c: string, k: string) => {
    const data = c === 'rooms' && k === 'room' ? room : tracks.get(k)
    return data ? ok({ record: { recordId: k, data: structuredClone(data) } }) : missing
  })
  const query = vi.fn(async (c: string, options: { where: Data, limit: number, offset?: number }) => {
    if (c === 'team_members') {
      expect(options).toEqual({ where: { teamId: 'room', userId: 'alice' }, limit: 2 })
      return ok({ records: [member], count: 1 })
    }
    const records = [...tracks].filter(([, d]) => d.roomId === options.where.roomId).map(([recordId, data], i) => ({ recordId, data: { capacitySlot: i, creationToken: 'fixture-' + recordId, ...data } }))
    const offset = options.offset ?? 0
    const page = records.slice(offset, offset + options.limit)
    return ok({ records: page, count: page.length, offset, ...(offset + page.length < records.length && { nextOffset: offset + page.length }) })
  })
  const create = vi.fn(async (_: string, data: Data, recordId: string): Promise<unknown> => {
    tracks.set(recordId, data)
    return ok({ recordId })
  })
  const update = vi.fn(async (c: string, k: string, data: Data): Promise<unknown> => {
    Object.assign(c === 'rooms' ? room : tracks.get(k)!, data)
    return ok({ recordId: k })
  })
  const remove = vi.fn(async (_: string, k: string) => {
    if (!tracks.delete(k)) return missing
    return ok({ deleted: true })
  })
  const tools = { get, query, create, update, remove }
  const call = (name: string, params: unknown, userId = 'alice', callerJwt = 'verified') =>
    actions[name]({ params, tools, userId, callerJwt } as unknown as ActionContext<Env>)
  const add = () => call('addTrack', { roomId: 'room', track })
  const del = () => call('deleteTrack', { roomId: 'room', trackId: 'target' })
  return { ...tools, call, add, del, room, tracks, member }
}

it('appends after existing and missing live tracks and uses independent server-generated identifiers', async () => {
  const f = fixture()
  for (const k of ['z', 'b', 'a']) f.tracks.set(k, stored)
  f.room.trackOrder = ['z', 'gone', 'z']
  const result = await f.add()
  const [, data, created] = f.create.mock.calls[0]
  expect(result).toEqual(ok({ trackId: created }))
  expect(data).toEqual({ ...stored, addedBy: 'alice', creationToken: expect.any(String), capacitySlot: 3 })
  expect(data.creationToken).not.toBe(created)
  expect(f.room.trackOrder).toEqual(['z', 'a', 'b', created])
})

it('sends only the editable patch for SDK merge, including explicit nulls', async () => {
  const f = fixture()
  f.tracks.set('target', { ...stored, energy: 3 })
  const patch = { bpm: null, energy: null, musicalKey: '  Am ' }
  expect(await f.call('updateTrack', { roomId: 'room', trackId: 'target', patch })).toEqual(ok({ trackId: 'target' }))
  expect(f.update.mock.calls).toEqual([['tracks', 'target', { ...patch, musicalKey: 'Am' }]])
  expect(f.tracks.get('target')).toEqual({ ...stored, ...patch, musicalKey: 'Am' })
})

it.each([{}, [], { title: ' ' }, { artist: 'a'.repeat(121) }, { bpm: NaN }, { bpm: Infinity }, { bpm: '100' },
  { bpm: 39 }, { bpm: 241 }, { energy: 0 }, { energy: 6 }, { energy: 2.5 }, { musicalKey: 1 },
  { musicalKey: 'x'.repeat(17) }, { addedBy: 'alice' }, { roomId: 'other' }, { ownerId: 'alice' }])(
  'rejects invalid patches before accessing records (%j)', async patch => {
    const f = fixture()
    expect((await f.call('updateTrack', { roomId: 'room', trackId: 'target', patch })).success).toBe(false)
    expect(f.get).not.toHaveBeenCalled()
  })

it.each([[], { roomId: 'room', track: [] }, { roomId: '../room', track }, { roomId: 'room', track, userId: 'bob' },
  { roomId: 'room', track: { title: 'x' } }, { roomId: 'room', track: { ...track, addedBy: 'bob' } }])(
  'rejects malformed creation (%j)', async params => {
    const f = fixture()
    expect((await f.call('addTrack', params)).success).toBe(false)
    expect(f.get).not.toHaveBeenCalled()
  })

it.each(['addTrack', 'updateTrack', 'deleteTrack', 'reorderTracks'])('requires verified identity and one exact active membership for %s', async name => {
  const f = fixture()
  const params = name === 'reorderTracks' ? { roomId: 'room', orderedTrackIds: [] } : name === 'addTrack' ? { roomId: 'room', track } : { roomId: 'room', trackId: 'target', ...(name === 'updateTrack' && { patch: track }) }
  for (const [uid, jwt] of [['', 'jwt'], ['anon-1', 'jwt'], ['alice', '']]) {
    expect((await f.call(name, params, uid, jwt)).success).toBe(false)
  }
  expect(f.get).not.toHaveBeenCalled()
  for (const records of [[], [f.member, f.member], [null], ...[{ status: null }, { status: 'inactive' }, { teamId: 'other' },
    { userId: 'bob' }].map(changes => [{ ...f.member, data: { ...f.member.data, ...changes } }])]) {
    f.query.mockResolvedValueOnce(ok({ records, count: records.length }))
    expect((await f.call(name, params)).success).toBe(false)
  }
  expect(f.create).not.toHaveBeenCalled()
  expect(f.update).not.toHaveBeenCalled()
  expect(f.remove).not.toHaveBeenCalled()
})

it('rejects a foreign track for both targeted writes', async () => {
  const f = fixture()
  f.tracks.set('target', { ...stored, roomId: 'other' })
  expect((await f.del()).success).toBe(false)
  expect((await f.call('updateTrack', { roomId: 'room', trackId: 'target', patch: track })).success).toBe(false)
  expect(f.update).not.toHaveBeenCalled()
  expect(f.remove).not.toHaveBeenCalled()
})

it('accepts only one competing local addition at 199 live tracks', async () => {
  const f = fixture()
  for (let i = 0; i < 199; i++) f.tracks.set(String(i), stored)
  const results = await Promise.all([f.add(), f.add()])
  expect(results.filter(r => r.success)).toHaveLength(1)
  expect((await f.add()).error).toMatch(/limit/)
  expect(f.tracks.size).toBe(200)
})

it('rescans after a definite conflict and generates a new pair of identifiers', async () => {
  const f = fixture()
  f.create.mockImplementationOnce(async () => {
    f.tracks.set('competing', stored)
    return { success: false, error: 'Duplicate: a record with roomId=room, capacitySlot=0 already exists in tracks' }
  })
  expect((await f.add()).success).toBe(true)
  const [first, second] = f.create.mock.calls
  expect(first[2]).not.toBe(second[2])
  expect(first[1].creationToken).not.toBe(second[1].creationToken)
  expect(second[1].capacitySlot).toBe(1)
})

it.each([null, -1, 200, 1.5])('refuses invalid persisted slot %s before dispatch', async slot => {
  const f = fixture()
  f.tracks.set('invalid', { ...stored, capacitySlot: slot })
  expect((await f.add()).success).toBe(false)
  expect(f.create).not.toHaveBeenCalled()
})

it.each(['recordId', 'capacitySlot', 'creationToken'])('rejects caller-owned %s', async field => {
  const f = fixture()
  expect((await f.call('addTrack', { roomId: 'room', track: { ...track, [field]: 'bad' } })).success).toBe(false)
  expect(f.create).not.toHaveBeenCalled()
})

it('recovers from lost delete acknowledgement and a failed first order write', async () => {
  const f = fixture()
  f.tracks.set('target', stored)
  f.tracks.set('keep', stored)
  f.room.trackOrder = ['target', 'keep', 'target']
  f.remove.mockImplementationOnce(async () => { f.tracks.delete('target'); throw Error(failure.error) })
  f.update.mockResolvedValueOnce(failure)
  expect(await f.del()).toEqual(ok({ trackId: 'target' }))
  expect(f.room.trackOrder).toEqual(['keep'])
  expect(f.update).toHaveBeenCalledTimes(2)
})

it('reports persistent order failure after deletion', async () => {
  const f = fixture()
  f.tracks.set('target', stored)
  f.room.trackOrder = ['target']
  f.update.mockResolvedValue(failure)
  expect((await f.del()).error).toMatch(/reconciliation/)
  expect(f.tracks.size).toBe(0)
})

it('sanitizes ambiguous creation and repairs order without retrying creation', async () => {
  const f = fixture()
  f.create.mockImplementationOnce(async (_, data, key) => { f.tracks.set(key, data); throw Error(failure.error) })
  const result = await f.add()
  const key = f.create.mock.calls[0][2]
  expect(result).toEqual(ok({ trackId: key }))
  expect(f.room.trackOrder).toEqual([key])
  expect(f.create).toHaveBeenCalledTimes(1)
})

it('fails closed on malformed room, query and update acknowledgements', async () => {
  const f = fixture()
  f.get.mockResolvedValueOnce(ok({ record: { recordId: 'wrong', data: f.room } }))
  expect((await f.add()).success).toBe(false)
  f.query.mockResolvedValueOnce(ok({ records: [f.member], count: 0 }))
  expect((await f.add()).success).toBe(false)
  expect(f.create).not.toHaveBeenCalled()
  f.tracks.set('target', stored)
  f.update.mockResolvedValueOnce(ok({ recordId: 'wrong' }))
  expect((await f.call('updateTrack', { roomId: 'room', trackId: 'target', patch: track })).success).toBe(false)
})

it('handles the SDK delete wire result and preserves the remaining order', async () => {
  const f = fixture()
  for (const k of ['a', 'target', 'z']) f.tracks.set(k, stored)
  f.room.trackOrder = ['z', 'target', 'a']
  expect(await f.del()).toEqual(ok({ trackId: 'target' }))
  expect(f.room.trackOrder).toEqual(['z', 'a'])
})

it('returns a controlled failure when a create is refused', async () => {
  const f = fixture()
  f.create.mockRejectedValueOnce(Error(failure.error))
  const result = await f.add()
  expect(result.success).toBe(false)
  expect(result.error).not.toContain(failure.error)
  expect(f.update).not.toHaveBeenCalled()
})

function reorderFixture() {
  const f = fixture()
  for (const key of ['a', 'b']) f.tracks.set(key, stored)
  f.room.trackOrder = ['a', 'b']
  return { ...f, move: (ids: unknown = ['b', 'a']) => f.call('reorderTracks', { roomId: 'room', orderedTrackIds: ids }) }
}

it('persists a complete permutation and returns the verified room ID', async () => {
  const f = reorderFixture()
  expect(await f.move()).toEqual(ok({ roomId: 'room' }))
  expect(f.room.trackOrder).toEqual(['b', 'a'])
  expect(f.update.mock.calls).toEqual([['rooms', 'room', { trackOrder: ['b', 'a'] }]])
})

it.each([null, ['a'], ['a', 'a'], ['a', 'foreign'], ['a', 'b', 'deleted']].map(ids => ({ ids })))(
  'rejects incomplete, duplicate, foreign and stale orders ($ids)', async ({ ids }) => {
    const f = reorderFixture()
    f.tracks.set('foreign', { ...stored, roomId: 'other' })
    expect((await f.move(ids)).success).toBe(false)
    expect(f.update).not.toHaveBeenCalled()
  })

it('rejects forged fields and a mismatched room envelope', async () => {
  const f = reorderFixture()
  expect((await f.call('reorderTracks', { roomId: 'room', orderedTrackIds: ['a','b'], userId: 'alice' })).success).toBe(false)
  expect(f.get).not.toHaveBeenCalled()
  f.get.mockResolvedValueOnce(ok({ record: { recordId: 'wrong', data: f.room } }))
  expect((await f.move()).success).toBe(false)
  expect(f.update).not.toHaveBeenCalled()
})

it.each(['add', 'delete', 'reorder', 'refusal', 'lost reply'])('verifies order after a competing write or %s', async mode => {
  const f = reorderFixture()
  f.update.mockImplementationOnce(async () => {
    if (mode === 'refusal') return failure
    if (mode !== 'reorder') f.room.trackOrder = ['b', 'a']
    if (mode === 'add') f.tracks.set('new', stored)
    if (mode === 'delete') f.tracks.delete('a')
    throw Error(failure.error)
  })
  const result = await f.move()
  expect(result.success).toBe(mode === 'lost reply')
  expect(result.error ?? '').not.toContain(failure.error)
  if (mode === 'add') expect(f.room.trackOrder).toEqual(['b','a','new'])
  if (mode === 'delete') expect(f.room.trackOrder).toEqual(['b'])
  if (mode === 'reorder') expect(f.update).toHaveBeenCalledTimes(1)
})

it('shares the isolate guard between reorder and track mutations', async () => {
  const f = reorderFixture()
  const results = await Promise.all([f.move(), f.add(), f.del(), f.move()])
  expect(results.map(r => r.success)).toEqual([true, false, false, false])
  expect(results.slice(1).every(r => r.error?.includes('busy'))).toBe(true)
})

it.each([
  { records: [], count: 0, nextOffset: 0 },
  { records: [], count: 0, offset: 2 },
  { records: [], count: 0, truncated: true },
])('refuses malformed pagination before allocating', async page => {
  const f = fixture()
  f.query.mockResolvedValueOnce(ok({ records: [f.member], count: 1 }))
  f.query.mockResolvedValueOnce(ok(page))
  expect((await f.add()).success).toBe(false)
  expect(f.create).not.toHaveBeenCalled()
})
