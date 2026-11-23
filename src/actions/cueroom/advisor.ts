import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { validBpm } from '../../cueroom/insights'

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const denied = () => ({ success: false as const, error: 'Transition unavailable. Refresh the setlist and retry.' })

// Free preflight only. This handler has no provider transport or write operations.
export const previewTransition: ActionHandler<Env> = async ({ userId, callerJwt, params, tools }) => {
  try {
    if (!callerJwt || !userId?.trim() || userId.startsWith('anon-') || !params ||
      Object.keys(params).length !== 3) return denied()
    const { roomId, fromId, toId } = params
    if (typeof roomId !== 'string' || !uuid.test(roomId) ||
      ![fromId, toId].every(id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id)) ||
      fromId === toId) return denied()
    const room = await tools.get('rooms', roomId)
    if (!room.success || room.error !== undefined || room.data.record.recordId !== roomId) return denied()
    const data = room.data.record.data
    if (data.roomId !== roomId || data.ownerId !== userId) return denied()
    const members = await tools.query('team_members', { where: { teamId: roomId, userId }, limit: 2 })
    if (!members.success || members.error !== undefined || members.data.count !== 1 ||
      members.data.records.length !== 1 || 'nextOffset' in members.data || ('truncated' in members.data && members.data.truncated)) return denied()
    const member = members.data.records[0].data
    if (member.teamId !== roomId || member.userId !== userId || member.status !== 'active') return denied()
    const order = data.trackOrder
    if (!Array.isArray(order) || order.length > 200 || new Set(order).size !== order.length) return denied()
    const index = order.indexOf(fromId)
    if (index < 0 || order[index + 1] !== toId) return denied()
    const bpms = []
    for (const id of [fromId, toId]) {
      const result = await tools.get('tracks', id as string)
      if (!result.success || result.error !== undefined || result.data.record.recordId !== id ||
        result.data.record.data.roomId !== roomId) return denied()
      const bpm = result.data.record.data.bpm
      bpms.push(typeof bpm === 'number' && validBpm(bpm) ? bpm : null)
    }
    const [from, to] = bpms
    const advice = from === null || to === null ? 'Tempo comparison unavailable. Check both tempos by ear.' :
      from === to ? 'Both tracks are at ' + from + ' BPM. Try a beatmatched transition.' :
      'Rehearse a tempo change from ' + from + ' to ' + to + ' BPM.'
    return { success: true, data: { advice } }
  } catch {
    return denied()
  }
}
