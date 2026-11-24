import {actions} from '../../src/actions'
import {aiTransitionAction} from '../../src/actions/cueroom/ai-transition'
import {reserveAI} from '../../src/server/ai-budget'
import { registerIntegrationSettings } from '../../src/server/integration-settings'
import { reserveInvitation } from '../../src/server/invitation-quota'
// Local workerd fixture. Only this test entry point exposes seeding and SQL inspection.
import { Hono } from 'hono'
import { AppRecordRoom } from '../../src/server/app-record-room'
import { registerActionRoutes } from '../../src/server/action-routes'
import { registerRealtimeRoutes } from '../../src/server/realtime-routes'
import { resolveAuth } from '../../src/server/http-routes'
import type { AppContext, Env } from '../../worker'

export class FixtureRoom extends AppRecordRoom {
  constructor(state: DurableObjectState, env: Env) {
    const sql = state.storage.sql
    if (!sql.exec("SELECT 1 FROM sqlite_master WHERE name='c_tracks'").toArray().length) {
      sql.exec(
        'CREATE TABLE c_tracks (_row_id TEXT PRIMARY KEY, _created_by TEXT, _created_at TEXT, _updated_at TEXT, col_roomid TEXT, col_title TEXT, col_artist TEXT, col_addedby TEXT)',
      )
      const count = state.id.name === 'overflow' ? 201 : 199
      for (let i = 0; i < count; i++)
        sql.exec(
          "INSERT INTO c_tracks VALUES (?, 'alice','old','old','room','Legacy','Artist','alice')",
          'legacy-' + i,
        )
      if (state.id.name === 'duplicates') {
        sql.exec('ALTER TABLE c_tracks ADD COLUMN col_capacityslot REAL')
        sql.exec('ALTER TABLE c_tracks ADD COLUMN col_creationtoken TEXT')
        sql.exec('UPDATE c_tracks SET col_capacityslot=1, col_creationtoken=_row_id')
      }
      if (state.id.name === 'wrong-index')
        sql.exec('CREATE INDEX uniq_c_tracks_roomId_capacitySlot ON c_tracks(col_roomid)')
    }
    super(state, env)
  }
  override async fetch(req: Request) {
    if (new URL(req.url).pathname === '/inspect') {
      const rows = this.sql.exec(await req.text()).toArray()
      return Response.json(rows)
    }
    if (new URL(req.url).pathname === '/cold') this.state.abort('test cold restart')
    if (req.url.endsWith('/api/tools/execute')) {
      const { tool, params } = (await req.clone().json()) as {
        tool: string
        params: { data?: { title?: string } }
      }
      if (tool === 'records.create' && params.data?.title === 'Lose reply') {
        await super.fetch(req)
        return new Response('Simulated lost acknowledgement', { status: 503 })
      }
    }
    return super.fetch(req)
  }
}

// Only this test bundle registers a metered action with an artificial price.
actions.fixturePairRace = async ctx => {
  const hooks = (ctx.env as Env & {TEST_HOOK: Fetcher}).TEST_HOOK
  let intercepted = false
  const tools = {...ctx.tools}
  tools.query = async <T extends Record<string, unknown>>(collection: string, options?: Parameters<typeof tools.query>[1]) => {
    const result = await ctx.tools.query<T>(collection, options)
    if (collection === 'tracks' && !intercepted) {
      intercepted = true
      await hooks.fetch('https://fixture/edit')
    }
    return result
  }
  return aiTransitionAction(1000, async () => {
    await hooks.fetch('https://fixture/dispatch')
    throw Error('Unexpected dispatch')
  })({...ctx,tools})
}

const app = new Hono<AppContext>()
app.onError((error, c) => c.json({ success: false, error: error.message }, 500))
registerIntegrationSettings(app)
// Miniflare's Node RPC bridge rejects an Origin header before workerd sees it.
// Recreate the browser's same-origin request inside this fixture Worker.
app.put('/test-settings', c => {
  const req = new Request(new URL('/api/cueroom/settings', c.req.url), c.req.raw)
  req.headers.set('Origin', new URL(req.url).origin)
  return app.fetch(req, c.env)
})
app.post('/test-reserve-ai', async c => c.json(await reserveAI(
  {...c.env,DEEPSPACE_APP_ID:'budget-race'}, crypto.randomUUID(), 'owner', crypto.randomUUID(), 1024, 25000)))
app.post('/test-reserve-email', async c => c.json(await reserveInvitation(
  c.env.INVITATION_QUOTA, 'owner', 'shared-room', crypto.randomUUID(), c.env.DEEPSPACE_APP_ID)))
registerActionRoutes(app, resolveAuth)
registerRealtimeRoutes(app)
app.all('/fixture/:scope/*', (c) => {
  const url = new URL(c.req.url)
  url.pathname = url.pathname.replace(/^\/fixture\/[^/]+/, '')
  return c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(c.req.param('scope'))).fetch(
    new Request(url, c.req.raw),
  )
})
export default app
