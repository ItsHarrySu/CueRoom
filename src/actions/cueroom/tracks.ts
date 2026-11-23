import { RECORD_NOT_FOUND, type ActionHandler, type ActionTools } from 'deepspace/worker'
import type { Env } from '../../../worker'

const capacity = 200
const busyRooms = new Set<string>()
const fail = (error: string) => ({ success: false as const, error })
const success = (trackId: string) => ({ success: true as const, data: { trackId } })
const invalid = () => { throw new Error('Invalid record data') }
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

function trackFields(value: unknown, creating: boolean) {
  if (!object(value) || !Object.keys(value).length) return null
  if (creating && !(Object.hasOwn(value, 'title') && Object.hasOwn(value, 'artist'))) return null
  const fields: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'title' || key === 'artist' || key === 'musicalKey') {
      if (key === 'musicalKey' && raw === null) {
        fields[key] = null
        continue
      }
      if (typeof raw !== 'string') return null
      const trimmed = raw.trim()
      const length = [...trimmed].length
      if (key === 'musicalKey' ? length > 16 : length < 1 || length > 120) return null
      fields[key] = trimmed
    } else if (key === 'bpm' || key === 'energy') {
      if (raw !== null) {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
        if (key === 'bpm' ? raw < 40 || raw > 240 : !Number.isInteger(raw) || raw < 1 || raw > 5) return null
      }
      fields[key] = raw
    } else return null
  }
  return fields
}

async function read(tools: ActionTools, collection: string, recordId: string) {
  const result = await tools.get(collection, recordId)
  if (result.success === false && result.error === RECORD_NOT_FOUND && result.data === undefined) return null
  if (result.success !== true || result.error !== undefined) return invalid()
  const row = result.data.record
  if (row.recordId !== recordId || !object(row.data)) return invalid()
  return row.data
}

async function order(tools: ActionTools, roomId: string): Promise<string[]> {
  const room = await read(tools, 'rooms', roomId)
  if (room?.roomId !== roomId || !Array.isArray(room.trackOrder) || !room.trackOrder.every(v => typeof v === 'string')) return invalid()
  return room.trackOrder
}

async function rows(tools: ActionTools, collection: string, where: Record<string, string>, limit: number) {
  const result = await tools.query(collection, { where, limit })
  if (result.success !== true || result.error !== undefined) return invalid()
  const { records, count } = result.data
  if (!Array.isArray(records) || records.length !== count || count > limit || 'nextOffset' in result.data) return invalid()
  for (const row of records) {
    if (!id(row.recordId) || !object(row.data) || !Object.entries(where).every(([k, v]) => row.data[k] === v)) return invalid()
  }
  return records
}

async function live(tools: ActionTools, roomId: string) {
  const records = await rows(tools, 'tracks', { roomId }, capacity + 1)
  const ids = new Set(records.map(row => row.recordId))
  if (ids.size !== records.length) return invalid()
  return ids
}

// Recompute from fresh snapshots after every write, including a lost acknowledgement.
async function reconcile(tools: ActionTools, roomId: string, trackId?: string, adding = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await order(tools, roomId)
    const missing = await live(tools, roomId)
    if (adding && missing.size > capacity) return 'over-capacity'
    if (trackId && missing.has(trackId) !== adding) return false
    const desired = stored.filter(key => missing.delete(key))
    const append = adding && trackId && missing.delete(trackId)
    desired.push(...[...missing].sort())
    if (append && trackId) desired.push(trackId)
    if (same(stored, desired)) return true
    if (attempt < 2) {
      try {
        await tools.update('rooms', roomId, { trackOrder: desired })
      } catch {
        // Read back before deciding whether another write is needed.
      }
    }
  }
  return false
}

type Operation = 'add' | 'update' | 'delete'
function action(op: Operation): ActionHandler<Env> {
  return async ({ userId, callerJwt, params, tools }) => {
    if (!userId?.trim() || userId.startsWith('anon-') || !callerJwt?.trim()) return fail('Authentication required.')
    const keys = op === 'add' ? ['roomId', 'track'] : op === 'update' ? ['roomId', 'trackId', 'patch'] : ['roomId', 'trackId']
    if (!object(params) || Object.keys(params).length !== keys.length || !keys.every(k => Object.hasOwn(params, k))) return fail('Invalid track request.')
    const { roomId, trackId } = params
    if (!id(roomId) || (op !== 'add' && !id(trackId))) return fail('Invalid identifier.')
    const fields = op === 'delete' ? {} : trackFields(op === 'add' ? params.track : params.patch, op === 'add')
    if (!fields) return fail('Invalid track fields.')
    try {
      await order(tools, roomId)
      const members = await rows(tools, 'team_members', { teamId: roomId, userId }, 2)
      if (members.length !== 1 || members[0].data.status !== 'active') return fail('Room access denied.')
    } catch {
      return fail('Room access denied.')
    }
    if (busyRooms.has(roomId)) return fail('Room busy. Retry the request.')
    busyRooms.add(roomId)
    try {
      if (op === 'add') {
        if ((await live(tools, roomId)).size >= capacity) return fail('Room track limit reached.')
        let created: string | undefined
        try {
          const result = await tools.create('tracks', { ...fields, roomId, addedBy: userId })
          if (result.success === true && result.error === undefined && id(result.data.recordId)) created = result.data.recordId
        } catch {
          // A lost create acknowledgement leaves no safe ID for a retry or rollback.
        }
        if (!created) {
          await reconcile(tools, roomId)
          return fail('Track creation unconfirmed. Refresh the room.')
        }
        const outcome = await reconcile(tools, roomId, created, true)
        if (outcome === 'over-capacity') {
          // Scope compensation to this call's acknowledged row and verified creator.
          try {
            await tools.deleteWhere('tracks', { recordId: created, roomId, addedBy: userId }, 1)
          } catch {
            // Reconcile even if cleanup committed without an acknowledgement.
          }
          if (await reconcile(tools, roomId, created) === true) return fail('Room track limit reached.')
        }
        return outcome === true ? success(created) : fail('Track order requires reconciliation.')
      }
      if (!id(trackId) || (await read(tools, 'tracks', trackId))?.roomId !== roomId) return fail('Track unavailable.')
      if (op === 'update') {
        const result = await tools.update('tracks', trackId, fields)
        return result.success === true && result.error === undefined && result.data.recordId === trackId
          ? success(trackId) : fail('Track update unconfirmed. Refresh the room.')
      }
      try {
        await tools.remove('tracks', trackId)
      } catch {
        // remove returns { deleted: true } on the wire. Confirm absence even
        // when the acknowledgement is malformed, negative or lost.
      }
      if (await read(tools, 'tracks', trackId) !== null) return fail('Track deletion unconfirmed.')
      return await reconcile(tools, roomId, trackId, false) ? success(trackId) : fail('Track order requires reconciliation.')
    } catch {
      return fail('Unable to confirm track action. Refresh the room.')
    } finally {
      busyRooms.delete(roomId)
    }
  }
}

export const addTrack = action('add')
export const updateTrack = action('update')
export const deleteTrack = action('delete')
