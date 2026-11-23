import { Hono } from 'hono'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker.js'
import { registerActionRoutes } from './action-routes.js'
import { registerAuthAndIntegrationRoutes, resolveAuth } from './http-routes.js'

const { upstream, verifyJwt } = vi.hoisted(() => ({
  upstream: vi.fn(),
  verifyJwt: vi.fn(async (_config: unknown, token: string) => ({
    result: token === 'member-token' ? { userId: 'ordinary-member' } : null,
  })),
}))

vi.mock('deepspace/worker', () => ({
  apiWorkerFetch: upstream,
  verifyJwt,
  lookupOwn: (map: Record<string, unknown>, name: string) =>
    Object.hasOwn(map, name) ? map[name] : undefined,
}))

vi.mock('../actions/index.js', () => ({
  actions: {
    probe: ({ params, tools }: { params: { target: string }, tools: ActionTools }) =>
      tools.integration(params.target),
  },
}))

const env = {
  APP_OWNER_JWT: 'test-owner-token',
  RECORD_ROOMS: { get: () => ({}), idFromName: (name: string) => name },
} as unknown as Env
const app = new Hono<AppContext>()
registerAuthAndIntegrationRoutes(app)
registerActionRoutes(app, resolveAuth)

beforeEach(() => {
  upstream.mockReset()
  upstream.mockResolvedValue(Response.json({ success: true }))
})

it.each(['composio/run', 'unconfigured/send', 'example/%72un', 'example/nested%2Fname'])(
  'denies anonymous and member execution for %s before contacting the provider',
  async (target) => {
    for (const token of ['', 'member-token']) {
      for (const method of ['GET', 'POST', 'DELETE']) {
        const headers = new Headers()
        if (token) headers.set('Authorization', 'Bearer ' + token)
        const res = await app.request('/api/integrations/' + target, { method, headers }, env)
        expect(res.status).toBe(403)
      }
    }
    expect(upstream).not.toHaveBeenCalled()
  },
)

it.each(['composio/run', 'unconfigured/send', 'example/nested%2Fname'])(
  'denies member action integration %s before contacting the provider',
  async (target) => {
    const res = await app.request('/api/actions/probe', {
      method: 'POST',
      headers: { Authorization: 'Bearer member-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: false, code: 'integration_disabled' })
    expect(upstream).not.toHaveBeenCalled()
  },
)

it('keeps the public catalog readable without forwarding credentials', async () => {
  const res = await app.request('/api/integrations', {}, env)
  expect(res.status).toBe(200)
  expect(upstream.mock.calls).toEqual([[env, '/api/integrations']])
})
