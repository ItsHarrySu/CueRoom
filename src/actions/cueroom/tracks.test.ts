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
  const query = vi.fn(async (c: string, options: { where: Data }) => {
    if (c === 'team_members') {
      expect(options).toEqual({ where: { teamId: 'room', userId: 'alice' }, limit: 2 })
      return ok({ records: [member], count: 1 })
    }
    const records = [...tracks].filter(([, d]) => d.roomId === options.where.roomId).map(([recordId, data]) => ({ recordId, data }))
    return ok({ records, count: records.length })
  })
  const create = vi.fn(async (_: string, data: Data) => {
    tracks.set('new', data)
    return ok({ recordId: 'new' })
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

it('appends after existing and missing live tracks and delegates ID allocation to RecordRoom', async () => {
  const f = fixture()
  for (const k of ['z', 'b', 'a']) f.tracks.set(k, stored)
  f.room.trackOrder = ['z', 'gone', 'z']
  expect(await f.add()).toEqual(ok({ trackId: 'new' }))
  expect(f.create.mock.calls).toEqual([['tracks', { ...stored, addedBy: 'alice' }]])
  expect(f.room.trackOrder).toEqual(['z', 'a', 'b', 'new'])
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

it.each(['addTrack', 'updateTrack', 'deleteTrack'])('requires verified identity and one exact active membership for %s', async name => {
  const f = fixture()
  const params = name === 'addTrack' ? { roomId: 'room', track } : { roomId: 'room', trackId: 'target', ...(name === 'updateTrack' && { patch: track }) }
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

function overflowFixture() {
  const f = fixture()
  for (let i = 0; i < 199; i++) f.tracks.set(String(i), stored)
  f.create.mockImplementationOnce(async (_, data) => {
    f.tracks.set('other', stored)
    f.tracks.set('new', data)
    f.room.trackOrder = ['other', 'new', '0', 'new']
    return ok({ recordId: 'new' })
  })
  return f
}

it('compensates its own addition when an external writer takes the last slot', async () => {
  const f = overflowFixture()
  expect((await f.add()).error).toMatch(/limit/)
  expect(f.tracks.size).toBe(200)
  expect(f.room.trackOrder).toContain('other')
  expect(f.room.trackOrder).not.toContain('new')
})

it.each(['creator', 'room', 'envelope'])('refuses compensation for a mismatched %s', async mismatch => {
  const f = overflowFixture()
  const get = f.get.getMockImplementation()!
  f.get.mockImplementation(async (collection, key) => {
    if (collection === 'tracks') {
      const row = f.tracks.get(key)!
      if (mismatch === 'creator') row.addedBy = 'bob'
      if (mismatch === 'room') row.roomId = 'foreign'
      if (mismatch === 'envelope') return ok({ record: { recordId: 'other', data: row } })
    }
    return get(collection, key)
  })
  expect(await f.add()).toEqual({ success: false, error: 'Track cleanup requires reconciliation.' })
  expect(f.remove).not.toHaveBeenCalled()
  expect(f.tracks.size).toBe(201)
})

it.each(['refused', 'lost acknowledgement', 'unconfirmed absence', 'order failure'])(
  'checks persisted cleanup after %s', async mode => {
    const f = overflowFixture()
    f.remove.mockImplementationOnce(async (_, key) => {
      if (mode === 'refused') return failure
      f.tracks.delete(key)
      if (mode === 'unconfirmed absence') f.get.mockResolvedValueOnce({ ...missing, data: {} })
      if (mode === 'order failure') f.update.mockResolvedValue(failure)
      throw Error(failure.error)
    })
    const result = await f.add()
    expect(f.remove.mock.calls).toEqual([['tracks', 'new']])
    expect(f.get.mock.calls.filter(([collection]) => collection === 'tracks')).toEqual([['tracks', 'new'], ['tracks', 'new']])
    expect(f.tracks.has('other')).toBe(true)
    expect(result.success).toBe(false)
    if (mode === 'lost acknowledgement') {
      expect(result.error).toMatch(/limit/)
      expect(f.room.trackOrder.slice(0, 2)).toEqual(['other', '0'])
      expect(f.room.trackOrder).not.toContain('new')
      expect(f.room.trackOrder).toHaveLength(200)
    } else {
      expect(result.error).toBe('Track cleanup requires reconciliation.')
    }
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
  f.create.mockImplementationOnce(async (_, data) => { f.tracks.set('unknown', data); throw Error(failure.error) })
  expect((await f.add()).error).toMatch(/unconfirmed/)
  expect(f.room.trackOrder).toEqual(['unknown'])
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
