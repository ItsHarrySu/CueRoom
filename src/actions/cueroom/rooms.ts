import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../../worker'

const fail = (error: string) => ({ success: false as const, error })
const partial = () => fail('Room creation incomplete. Membership and room require reconciliation.')
const denied = () => fail('Invalid room invitation.')

function fields(params: unknown, keys: string[]): boolean {
  return !!params && typeof params === 'object' && !Array.isArray(params)
    && Object.keys(params).length === keys.length && keys.every(key => Object.hasOwn(params, key))
}

async function readRoom(tools: ActionTools, id: string) {
  const result = await tools.get('rooms', id)
  if (result.success && result.data.record.recordId === id) return result.data.record.data
  if (!result.success && result.error === 'Record not found') return null
  throw new Error('Room lookup failed')
}

export const createRoom: ActionHandler<Env> = async ({ userId, callerJwt, params, tools }) => {
  if (!userId?.trim() || !callerJwt || userId.startsWith('anon-')) return fail('Authentication required.')
  if (!fields(params, ['name']) || typeof params.name !== 'string') return fail('Invalid room name.')
  const name = params.name.trim()
  if (!name || [...name].length > 80) return fail('Invalid room name.')

  // Scope random IDs by creator. Even concurrent identical random draws then
  // compete for the same unique (teamId, userId) reservation before any upsert.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId))
  const scope = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const roomId = scope + '-' + crypto.randomUUID()
  const inviteToken = crypto.randomUUID()
  let memberId: string
  try {
    if (await readRoom(tools, roomId)) return fail('Room ID unavailable.')
    const member = await tools.create('team_members', { teamId: roomId, userId, status: 'active' })
    if (!member.success) return fail('Owner membership creation failed.')
    memberId = member.data.recordId
    if (!memberId) return partial()
  } catch {
    return partial()
  }

  const created = { success: true as const, data: { roomId } }
  try {
    const room = await tools.create('rooms', { roomId, ownerId: userId, name, inviteToken, trackOrder: [] }, roomId)
    if (room.success && room.data.recordId === roomId) return created
  } catch {
    // A lost acknowledgement can follow a committed write.
  }
  try {
    const stored = await readRoom(tools, roomId)
    if (stored?.roomId === roomId && stored.ownerId === userId && stored.inviteToken === inviteToken) return created
    if (stored) return partial()
    const removed = await tools.remove('team_members', memberId)
    return removed.success ? fail('Room creation failed.') : partial()
  } catch {
    return partial()
  }
}

async function membership(tools: ActionTools, teamId: string, userId: string) {
  const result = await tools.query('team_members', { where: { teamId, userId }, limit: 2 })
  if (!result.success) throw new Error('Membership lookup failed')
  const rows = result.data.records
  if (!rows.length) return 'absent'
  const data = rows[0].data
  return rows.length === 1 && data.teamId === teamId && data.userId === userId && data.status === 'active'
    ? 'active' : 'invalid'
}

export const joinRoom: ActionHandler<Env> = async ({ userId, callerJwt, params, tools }) => {
  if (!userId?.trim() || !callerJwt || userId.startsWith('anon-')) return fail('Authentication required.')
  if (!fields(params, ['roomId', 'inviteToken'])) return denied()
  const { roomId, inviteToken } = params
  if (typeof roomId !== 'string' || !roomId.trim() || typeof inviteToken !== 'string' || !inviteToken.trim()) return denied()
  const joined = { success: true as const, data: { joined: true } }
  try {
    const room = await readRoom(tools, roomId)
    if (!room || room.roomId !== roomId || room.inviteToken !== inviteToken) return denied()
    const current = await membership(tools, roomId, userId)
    if (current === 'active') return joined
    if (current === 'absent') {
      const inserted = await tools.create('team_members', { teamId: roomId, userId, status: 'active' })
      if (inserted.success) return joined
      if (inserted.error.startsWith('Duplicate:') && await membership(tools, roomId, userId) === 'active') return joined
    }
  } catch {
    // Raw transport and record errors can contain private data.
  }
  return fail('Unable to join room.')
}
