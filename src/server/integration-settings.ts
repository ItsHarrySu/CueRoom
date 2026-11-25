import { verifiedEmailAcknowledgement } from './email-transport'
import { aiReady } from './ai-budget'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod/v4'
import type { AppContext, Env } from '../../worker'
import { resolveAuth } from './http-routes'

export const settingsTable = `CREATE TABLE IF NOT EXISTS integration_settings (
  app TEXT NOT NULL, feature TEXT NOT NULL, enabled INTEGER NOT NULL,
  PRIMARY KEY(app, feature))`
const input = z.strictObject({ feature: z.enum(['email','ai']), enabled: z.boolean() })

export function emailReady(env: Env, verified = !!verifiedEmailAcknowledgement) {
  return verified && env.EMAIL_SENDING_ENABLED === 'true' && !!env.API_WORKER && !!env.APP_OWNER_JWT?.trim()
}

export async function readSettings(env: Env) {
  if (!env.DEEPSPACE_APP_ID?.trim()) throw Error('Missing app identity')
  const db = env.INVITATION_QUOTA
  if (!db) return { email: false, ai: false }
  const [, rows] = await db.batch<{feature: string; enabled: number}>([db.prepare(settingsTable),
    db.prepare('SELECT feature, enabled FROM integration_settings WHERE app = ?').bind(env.DEEPSPACE_APP_ID)])
  const selected = (feature: string) => rows.results.some(r => r.feature === feature && r.enabled === 1)
  return { email: selected('email'), ai: selected('ai') }
}

export function registerIntegrationSettings(app: Hono<AppContext>) {
  const path = '/api/cueroom/settings'
  app.use(path, bodyLimit({ maxSize: 128 }))
  app.on(['GET','PUT'], path, async c => {
    c.header('Cache-Control','no-store')
    const env = c.env
    const auth = await resolveAuth(c.req.raw, env)
    if (!auth?.userId || auth.userId.startsWith('anon-')) return c.json({error:'Sign in required'},401)
    const owner = !!env.OWNER_USER_ID?.trim() && auth.userId === env.OWNER_USER_ID
    if (!env.DEEPSPACE_APP_ID?.trim()) return c.json({error:'Settings unavailable'},503)
    if (c.req.method === 'PUT') {
      if (!env.INVITATION_QUOTA) return c.json({error:'Settings unavailable'},503)
      if (!owner || c.req.header('Origin') !== new URL(c.req.url).origin) return c.json({error:'Forbidden'},403)
      if (c.req.header('Content-Type') !== 'application/json') return c.json({error:'Expected JSON'},415)
      const value = input.safeParse(await c.req.json().catch(() => null))
      if (!value.success) return c.json({error:'Invalid setting'},400)
      await env.INVITATION_QUOTA.batch([env.INVITATION_QUOTA.prepare(settingsTable),
        env.INVITATION_QUOTA.prepare(`INSERT INTO integration_settings VALUES (?,?,?)
          ON CONFLICT(app,feature) DO UPDATE SET enabled=excluded.enabled`)
          .bind(env.DEEPSPACE_APP_ID,value.data.feature,Number(value.data.enabled))])
    }
    const settings = await readSettings(env)
    return c.json({owner, preferences: owner ? settings : undefined,
      email: settings.email && emailReady(env), ai: owner && settings.ai && aiReady(env)})
  })
}
