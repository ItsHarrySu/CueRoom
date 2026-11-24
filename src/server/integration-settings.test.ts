import { Hono } from 'hono'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { afterAll, expect, it, vi } from 'vitest'
import type { AppContext, Env } from '../../worker'
import { registerIntegrationSettings } from './integration-settings'

vi.mock('./http-routes', () => ({resolveAuth: async (r: Request) => {
  const userId = r.headers.get('Authorization')
  return userId ? {userId} : null
}}))
const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {}',d1Databases:['prefs']}))
afterAll(() => mf.dispose())

it('isolates durable owner preferences by feature and app, with independent deployment gates', async () => {
  const db = await mf.getD1Database('prefs')
  const env = {OWNER_USER_ID:'owner', DEEPSPACE_APP_ID:'one', INVITATION_QUOTA:db} as unknown as Env
  function call(user: string, feature?: string, origin = 'https://app.test') {
    const app = new Hono<AppContext>()
    registerIntegrationSettings(app)
    return app.request('https://app.test/api/cueroom/settings', {method:feature?'PUT':'GET',
      headers:{Authorization:user,Origin:origin,'Content-Type':'application/json'},
      body:feature && JSON.stringify({feature,enabled:true})},env)
  }
  expect((await call('')).status).toBe(401)
  expect((await call('room-owner','email')).status).toBe(403)
  expect((await call('owner','email','https://other.test')).status).toBe(403)
  expect(await (await call('owner')).json()).toMatchObject({preferences:{email:false,ai:false}})
  await Promise.all([call('owner','email'),call('owner','ai')])
  expect(await (await call('owner')).json()).toMatchObject({preferences:{email:true,ai:true},email:false,ai:false})
  expect(await (await call('room-owner')).json()).not.toHaveProperty('preferences')
  env.DEEPSPACE_APP_ID = 'two'
  expect(await (await call('owner')).json()).toMatchObject({preferences:{email:false,ai:false}})
})
