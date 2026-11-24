import { afterAll, expect, it, vi } from 'vitest'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { aiTransitionAction, generateTransition } from './ai-transition'
import { settingsTable } from '../../server/integration-settings'
import { reserveAI } from '../../server/ai-budget'
import { snapshotDigest, transitionMetadata } from '../../cueroom/transition-snapshot'

const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {}',d1Databases:['budget','action','wire']}))
afterAll(() => mf.dispose())
const roomId = crypto.randomUUID()
async function context(database: string) {
  const db = await mf.getD1Database(database) as unknown as D1Database
  await db.batch([db.prepare(settingsTable),db.prepare("INSERT OR REPLACE INTO integration_settings VALUES ('app','ai',1)")])
  const rows = ['a','b'].map((recordId,capacitySlot) => ({recordId,data:{
    roomId,capacitySlot,creationToken:crypto.randomUUID(),title:recordId,artist:'DJ',privateField:'private',
  }}))
  const metadata = rows.map(row => transitionMetadata(row.recordId,row.data))
  const ctx = {userId:'owner',callerJwt:'user-fixture',params:{roomId,fromId:'a',toId:'b',
    snapshot:await snapshotDigest(metadata),confirmation:crypto.randomUUID()},
    env:{OWNER_USER_ID:'owner',DEEPSPACE_APP_ID:'app',AI_GENERATION_ENABLED:'true',
      APP_OWNER_JWT:'owner-fixture',API_WORKER:{},INVITATION_QUOTA:db},
    tools:{get:async (collection:string,id:string) => ({success:true,data:{record:collection==='rooms'?
      {recordId:roomId,data:{roomId,ownerId:'owner',trackOrder:['a','b']}}:rows.find(row => row.recordId===id)}}),
    query:async (collection:string) => {
      const records = collection==='tracks'?rows:[{data:{teamId:roomId,userId:'owner',status:'active'}}]
      return {success:true,data:{count:records.length,records}}
    }}}
  return {ctx:ctx as unknown as ActionContext<Env>,metadata}
}
it('requires a verified ceiling, enabled deployment and preference, owner identity and matching snapshot',async () => {
  const {ctx,metadata} = await context('action')
  const transport = vi.fn(async () => ({fromId:'a',toId:'b',advice:'Crossfade.'}))
  const run = aiTransitionAction(5000,transport)
  expect((await generateTransition(ctx)).success).toBe(false)
  expect((await run({...ctx,userId:'other'})).success).toBe(false)
  expect((await run({...ctx,env:{...ctx.env,AI_GENERATION_ENABLED:'false'}})).success).toBe(false)
  expect((await run({...ctx,params:{...ctx.params,snapshot:'0'.repeat(64)}})).success).toBe(false)
  const pref = ctx.env.INVITATION_QUOTA.prepare("UPDATE integration_settings SET enabled=? WHERE feature='ai'")
  await pref.bind(0).run()
  expect((await run(ctx)).success).toBe(false)
  expect(transport).not.toHaveBeenCalled()
  await pref.bind(1).run()
  const race = await Promise.all([run(ctx),run(ctx)])
  expect(race.filter(r=>r.success)).toHaveLength(1)
  expect(transport.mock.calls).toEqual([[ctx.env,JSON.stringify(metadata)]])
  transport.mockResolvedValue({fromId:'b',toId:'a',advice:'Wrong pair.'})
  expect((await run({...ctx,params:{...ctx.params,confirmation:crypto.randomUUID()}})).success).toBe(false)
})
it('enforces the lifetime app budget under concurrent attempts in independent rooms',async () => {
  const {ctx} = await context('budget')
  const results = await Promise.all(Array.from({length:12},(_,i) =>
    reserveAI(ctx.env,'room'+i,'owner'+i,crypto.randomUUID(),2000,25000)))
  expect(results.filter(Boolean)).toHaveLength(4)
})
it('sends one bounded fixed-model request and never treats an unknown envelope as advice',async () => {
  const {ctx,metadata} = await context('wire')
  const fetch = vi.fn<(url:string,init:RequestInit) => Promise<Response>>().mockResolvedValue(Response.json({accepted:true}))
  ctx.env.API_WORKER = {fetch} as unknown as Fetcher
  const run = aiTransitionAction(1000)
  expect((await run(ctx)).success).toBe(false)
  expect((await run(ctx)).success).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url,init] = fetch.mock.calls[0]
  expect(url).toMatch(/\/api\/integrations\/openai\/chat-completion$/)
  expect(init.headers).toMatchObject({Authorization:'Bearer owner-fixture'})
  const body = JSON.parse(String(init.body))
  expect(body).toMatchObject({model:'gpt-5.4-mini',max_tokens:500})
  expect(JSON.parse(body.messages[1].content)).toEqual(metadata)
})
