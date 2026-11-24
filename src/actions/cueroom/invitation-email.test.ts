import { afterAll, expect, it, vi } from 'vitest'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { invitationEmailAction, sendInvitationEmail } from './invitation-email'
import { settingsTable } from '../../server/integration-settings'
import { reserveInvitation } from '../../server/invitation-quota'

const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {}',
  d1Databases: ['denial', 'delivery', 'dedup', 'room', 'owner', 'app'] }))
afterAll(() => mf.dispose())
const database = async (name: string) => {
  const db = await mf.getD1Database(name) as unknown as D1Database
  await db.batch([db.prepare(settingsTable), db.prepare("INSERT OR IGNORE INTO integration_settings VALUES ('test','email',1)")])
  return db
}
const roomId = crypto.randomUUID()
const inviteToken = crypto.randomUUID()
const deliver = vi.fn(async () => 'accepted' as const)

function context(options: { user?: string; status?: string; recipient?: unknown; extra?: object;
  db?: D1Database; callerJwt?: string; confirmation?: string } = {}) {
  return { userId: options.user ?? 'owner', callerJwt: options.callerJwt ?? 'verified',
    params: { roomId, recipient: options.recipient ?? 'guest@example.org',
      confirmation: options.confirmation ?? crypto.randomUUID(), ...options.extra },
    env: { APP_NAME: 'cue-test', DEEPSPACE_APP_ID: 'test', EMAIL_SENDING_ENABLED: 'true', API_WORKER: {}, APP_OWNER_JWT: 'fixture', INVITATION_QUOTA: options.db },
    tools: {
      get: vi.fn(async () => ({ success: true, data: { record: { recordId: roomId,
        data: { ownerId: 'owner', roomId, inviteToken } } } })),
      query: vi.fn(async () => ({ success: true, data: { count: 1, records: [
        { data: { userId: 'owner', teamId: roomId, status: options.status ?? 'active' } },
      ] } })),
    },
  } as unknown as ActionContext<Env>
}

it.each([{ user: 'member' }, { user: 'outsider' }, { status: 'inactive' }, { callerJwt: '' },
  { recipient: ['a@example.org'] }, { recipient: 'a@example.org,b@example.org' },
  { recipient: 'a@example.org\r\nBcc:b@example.org' }, { extra: { from: 'owner' } },
  { extra: { inviteUrl: 'untrusted' } }])('denies invalid invitation %j before dispatch', async options => {
  const transport = vi.fn(async () => 'accepted' as const)
  const db = await database('denial')
  expect((await invitationEmailAction(transport)(context({ ...options, db }))).success).toBe(false)
  expect(transport).not.toHaveBeenCalled()
})

it('keeps production disabled and fails closed on unavailable storage', async () => {
  expect(await sendInvitationEmail(context())).toMatchObject({ success: false, error: expect.stringContaining("unavailable") })
  const transport = vi.fn()
  expect((await invitationEmailAction(transport)(context())).success).toBe(false)
  expect(transport).not.toHaveBeenCalled()
})

it('constructs the invitation from trusted data and dispatches once under concurrent replay', async () => {
  const ctx = context({ db: await database('delivery') })
  const send = invitationEmailAction(deliver)
  const results = await Promise.all([send(ctx), send(ctx)])
  expect(results.filter(r => r.success)).toHaveLength(1)
  expect(deliver.mock.calls).toEqual([[{ recipient: 'guest@example.org', subject: 'Invitation to a CueRoom setlist',
    text: 'Sign in to CueRoom and accept the invitation: https://cue-test.app.space/rooms/' + roomId + '#invite=' + inviteToken }, ctx.env]])
})

it('retains the reservation on ambiguous failure and hides private errors', async () => {
  const transport = vi.fn().mockRejectedValue(Error(inviteToken))
  const send = invitationEmailAction(transport)
  const ctx = context({ db: await database('dedup') })
  expect(await send(ctx)).toMatchObject({ success: false, error: 'Delivery could not be confirmed.' })
  expect((await send(ctx)).success).toBe(false)
  expect(transport).toHaveBeenCalledTimes(1)
})

it.each([{ scope: 'room', limit: 3 }, { scope: 'owner', limit: 10 }, { scope: 'app', limit: 30 }])(
  'atomically bounds concurrent attempts at the $scope limit', async ({ scope, limit }) => {
    const db = await database(scope)
    const results = await Promise.all(Array.from({ length: limit + 5 }, (_, i) =>
      reserveInvitation(db, scope === 'app' ? 'owner-' + i : 'owner',
        scope === 'room' ? 'room' : 'room-' + i, crypto.randomUUID(), 'test')))
    expect(results.filter(Boolean)).toHaveLength(limit)
  })

it('blocks dispatch when the room limit is exhausted', async () => {
  const db = await database('room')
  const transport = vi.fn(async () => 'accepted' as const)
  const send = invitationEmailAction(transport)
  for (let i = 0; i < 3; i++) expect((await send(context({ db }))).success).toBe(true)
  expect((await send(context({ db }))).success).toBe(false)
  expect(transport).toHaveBeenCalledTimes(3)
})

it('denies production with both switches on before reservation or transport', async () => {
  const ctx = context({db: await database('denial')})
  const fetch = vi.fn()
  ctx.env.API_WORKER = {fetch} as unknown as Fetcher
  expect((await sendInvitationEmail(ctx)).success).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
  expect(await ctx.env.INVITATION_QUOTA.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='invitation_attempts'").first('n')).toBe(0)
})

it('reserves nothing while the master or runtime preference is off', async () => {
  const ctx = context({db: await database('denial')})
  const send = invitationEmailAction(deliver)
  ctx.env.EMAIL_SENDING_ENABLED = 'TRUE'
  expect((await send(ctx)).success).toBe(false)
  ctx.env.EMAIL_SENDING_ENABLED = 'true'
  await ctx.env.INVITATION_QUOTA.prepare("UPDATE integration_settings SET enabled=0").run()
  expect((await send(ctx)).success).toBe(false)
  expect(await ctx.env.INVITATION_QUOTA.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name='invitation_attempts'").first('COUNT(*)')).toBe(0)
})
