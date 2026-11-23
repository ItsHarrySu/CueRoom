import { describe, it, expect, vi } from 'vitest'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { actions } from '../index'

const missing = { success: false, error: 'Record not found' }
const secret = 'private-invitation'
const failure = { success: false, error: secret }
const ok = (data: unknown) => ({ success: true, data })
const room = (token = secret) => ok({ record: { recordId: 'room', data: { roomId: 'room', inviteToken: token } } })
const members = (status?: string | null, teamId = 'room') => ok({ records: status === undefined ? []
  : [{ data: { teamId, userId: 'alice', status } }] })

function fixture() {
  const get = vi.fn().mockResolvedValue(missing)
  const create = vi.fn().mockImplementation(async (_collection, _data, id) => ok({ recordId: id ?? 'member' }))
  const remove = vi.fn().mockResolvedValue(ok({ recordId: 'member' }))
  const query = vi.fn().mockResolvedValue(members())
  function call(action: string, params: unknown, userId = 'alice') {
    return actions[action]({ userId, callerJwt: 'verified', params, tools: { get, create, remove, query } } as unknown as ActionContext<Env>)
  }
  return { get, create, remove, query, call, join: () => call('joinRoom', { roomId: 'room', inviteToken: secret }) }
}

describe('createRoom', () => {
  it('reserves owner membership before writing the trimmed room and returns only its ID', async () => {
    const f = fixture()
    const result = await f.call('createRoom', { name: ' Set ' })
    const id = f.create.mock.calls[1][2]
    expect(result).toEqual(ok({ roomId: id }))
    expect(f.create.mock.calls).toEqual([
      ['team_members', { teamId: id, userId: 'alice', status: 'active' }],
      ['rooms', { roomId: id, ownerId: 'alice', name: 'Set', inviteToken: expect.any(String), trackOrder: [] }, id],
    ])
  })

  it.each([null, [], { name: 1 }, { name: ' ' }, { name: 'x'.repeat(81) }, { name: 'x', ownerId: 'bob' }])(
    'rejects invalid input', async params => {
      const f = fixture()
      expect((await f.call('createRoom', params)).success).toBe(false)
      expect(f.get).not.toHaveBeenCalled()
    })

  it('accepts an 80-character name', async () => {
    expect((await fixture().call('createRoom', { name: 'x'.repeat(80) })).success).toBe(true)
  })

  it('stops before writing for an existing room or failed lookup', async () => {
    for (const response of [failure, ok({ record: { recordId: 'different', data: {} } })]) {
      const f = fixture()
      f.get.mockResolvedValue(response)
      expect((await f.call('createRoom', { name: 'x' })).success).toBe(false)
      expect(f.create).not.toHaveBeenCalled()
    }
    const f = fixture()
    f.get.mockImplementation(async (_, recordId) => ok({ record: { recordId, data: {} } }))
    expect((await f.call('createRoom', { name: 'x' })).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
  })

  it('stops on membership failure', async () => {
    const f = fixture()
    f.create.mockResolvedValueOnce(failure)
    expect((await f.call('createRoom', { name: 'x' })).success).toBe(false)
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.remove).not.toHaveBeenCalled()
  })

  it.each([true, false])('reports room failure and cleanup outcome', async cleaned => {
    const f = fixture()
    f.create.mockResolvedValueOnce(ok({ recordId: 'member' })).mockResolvedValueOnce(failure)
    if (!cleaned) f.remove.mockResolvedValue(failure)
    const result = await f.call('createRoom', { name: 'x' })
    expect(f.remove).toHaveBeenCalledWith('team_members', 'member')
    expect(result.error).toMatch(cleaned ? /creation failed/ : /reconciliation/)
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('preserves membership if the room write outcome is unknown', async () => {
    const f = fixture()
    f.get.mockResolvedValueOnce(missing).mockResolvedValueOnce(failure)
    f.create.mockResolvedValueOnce(ok({ recordId: 'member' })).mockRejectedValueOnce(Error(secret))
    expect((await f.call('createRoom', { name: 'x' })).error).toMatch(/reconciliation/)
    expect(f.remove).not.toHaveBeenCalled()
  })

  it('recovers a committed room after acknowledgement loss', async () => {
    const f = fixture()
    f.create.mockResolvedValueOnce(ok({ recordId: 'member' })).mockRejectedValueOnce(Error(secret))
    f.get.mockResolvedValueOnce(missing).mockImplementation(async (_, recordId) =>
      ok({ record: { recordId, data: f.create.mock.calls[1][1] } }))
    expect((await f.call('createRoom', { name: 'x' })).success).toBe(true)
    expect(f.remove).not.toHaveBeenCalled()
  })
})

describe('joinRoom', () => {
  it.each([missing, room('wrong')])('conceals missing rooms and invalid tokens', async response => {
    const f = fixture()
    f.get.mockResolvedValue(response)
    expect(await f.join()).toEqual({ success: false, error: 'Invalid room invitation.' })
    expect(f.query).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it('inserts once across repeated valid joins', async () => {
    const f = fixture()
    f.get.mockResolvedValue(room())
    f.query.mockResolvedValueOnce(members()).mockResolvedValueOnce(members('active'))
    expect(await f.join()).toEqual(ok({ joined: true }))
    expect(await f.join()).toEqual(ok({ joined: true }))
    expect(f.create.mock.calls).toEqual([['team_members', { teamId: 'room', userId: 'alice', status: 'active' }]])
    expect(f.query).toHaveBeenCalledWith('team_members', { where: { teamId: 'room', userId: 'alice' }, limit: 2 })
  })

  it.each([members(null), members('inactive'), failure])('rejects invalid membership or lookup failure', async response => {
    const f = fixture()
    f.get.mockResolvedValue(room())
    f.query.mockResolvedValue(response)
    expect((await f.join()).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
  })

  it.each([[members('active'), true], [members(null), false], [members('active', 'other'), false], [failure, false]] as const)(
    'rereads the exact active pair after a duplicate refusal', async (response, success) => {
      const f = fixture()
      f.get.mockResolvedValue(room())
      f.query.mockResolvedValueOnce(members()).mockResolvedValueOnce(response)
      f.create.mockResolvedValue({ ...failure, error: 'Duplicate: ' + secret })
      const result = await f.join()
      expect(result.success).toBe(success)
      expect(JSON.stringify(result)).not.toContain(secret)
    })

  it('sanitizes failed inserts', async () => {
    const f = fixture()
    f.get.mockResolvedValue(room())
    f.create.mockResolvedValue(failure)
    expect(await f.join()).toEqual({ success: false, error: 'Unable to join room.' })
  })

  it.each([{ userId: 'bob' }, { ownerId: 'bob' }, { roomId: 3 }, { inviteToken: null }])('rejects malformed fields', async extra => {
    const f = fixture()
    expect((await f.call('joinRoom', { roomId: 'room', inviteToken: secret, ...extra })).success).toBe(false)
    expect(f.get).not.toHaveBeenCalled()
  })
})

it.each(['createRoom', 'joinRoom'])('requires an authenticated caller for %s', async action => {
  const f = fixture()
  expect((await f.call(action, {}, '')).error).toMatch(/Authentication/)
  expect(f.get).not.toHaveBeenCalled()
})
