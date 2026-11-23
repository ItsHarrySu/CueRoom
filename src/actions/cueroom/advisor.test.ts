import { expect, it, vi } from 'vitest'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { previewTransition } from './advisor'

const roomId = '00000000-0000-4000-8000-000000000001'
const params = { roomId, fromId: 'a', toId: 'b' }

async function preview(userId = 'owner', status = 'active', input: Record<string, unknown> = params) {
  const integration = vi.fn()
  const get = vi.fn(async (collection, recordId) => ({
    success: true, data: { record: { recordId, data: collection === 'rooms'
      ? { ownerId: 'owner', roomId, trackOrder: ['a', 'b'] }
      : { roomId, bpm: recordId === 'a' ? 120 : 125 } } },
  }))
  const query = vi.fn(async () => ({ success: true, data: {
    count: 1, records: [{ data: { teamId: roomId, userId, status } }],
  } }))
  const result = await previewTransition({ params: input, callerJwt: 'verified', userId,
    tools: { get, query, integration } } as unknown as ActionContext<Env>)
  expect(integration).not.toHaveBeenCalled()
  return result
}

it('returns a free preview from the exact adjacent tracks', async () => {
  expect(await preview()).toEqual({ success: true, data: { advice: 'Rehearse a tempo change from 120 to 125 BPM.' } })
})
it.each(['member', 'outsider', '', 'anon-visitor'])('denies caller %s', async user => {
  expect((await preview(user)).success).toBe(false)
})
it('rejects inactive owners, stale adjacency and unexpected fields', async () => {
  expect((await preview('owner', 'inactive')).success).toBe(false)
  expect((await preview('owner', 'active', { ...params, toId: 'c' })).success).toBe(false)
  expect((await preview('owner', 'active', { ...params, billing: 'developer' })).success).toBe(false)
})
