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

async function inventory(tools: ActionTools, roomId: string) {
  const ids = new Set<string>()
  const slots = new Set<number>()
  let offset = 0
  for (;;) {
    const options = { where: { roomId }, orderBy: 'capacitySlot', orderDir: 'asc' as const, limit: 50, offset }
    const result = await tools.query('tracks', options)
    if (result.success !== true || result.error !== undefined) return invalid()
    const page = result.data
    if (!Array.isArray(page.records) || page.count !== page.records.length || page.count > options.limit ||
      ('offset' in page && page.offset !== offset)) return invalid()
    for (const row of page.records) {
      const slot = row.data.capacitySlot
      if (!id(row.recordId) || ids.has(row.recordId) || row.data.roomId !== roomId ||
        !id(row.data.creationToken) || typeof slot !== 'number' || !Number.isInteger(slot) ||
        slot < 0 || slot >= capacity || slots.has(slot)) return invalid()
      ids.add(row.recordId)
      slots.add(slot)
    }
    if (!('nextOffset' in page)) {
      if ('truncated' in page && page.truncated) return invalid()
      return { ids, slots }
    }
    offset += page.count
    if (!page.count || page.nextOffset !== offset || offset >= capacity) return invalid()
  }
}

async function live(tools: ActionTools, roomId: string) {
  return (await inventory(tools, roomId)).ids
}

// Recompute from fresh snapshots after every write, including a lost acknowledgement.
async function reconcile(tools: ActionTools, roomId: string, trackId?: string, adding = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await order(tools, roomId)
    const missing = await live(tools, roomId)
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

async function allocate(tools: ActionTools, roomId: string, userId: string, fields: Record<string, unknown>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { slots } = await inventory(tools, roomId)
    if (slots.size === capacity) return fail('Room track limit reached.')
    let capacitySlot = 0
    while (slots.has(capacitySlot)) capacitySlot++
    const trackId = crypto.randomUUID()
    const creationToken = crypto.randomUUID()
    try {
      const result = await tools.create('tracks', { ...fields, roomId, addedBy: userId, capacitySlot, creationToken }, trackId)
      if (result.success === false && result.error ===
        `Duplicate: a record with roomId=${roomId}, capacitySlot=${capacitySlot} already exists in tracks`) continue
    } catch {
      // A committed write may lose its reply. Only inspect this attempt's ID.
    }
    const track = await read(tools, 'tracks', trackId)
    if (track?.creationToken !== creationToken || track.roomId !== roomId ||
      track.capacitySlot !== capacitySlot || track.addedBy !== userId)
      return fail('Track creation unconfirmed. Refresh the room.')
    return await reconcile(tools, roomId, trackId, true) ? success(trackId) : fail('Track order requires reconciliation.')
  }
  return fail('Room busy. Retry the request.')
}

async function reorder(tools: ActionTools, roomId: string, ids: string[]) {
  const matches = (current: Set<string>) => current.size === ids.length && ids.every(key => current.has(key))
  const stale = () => fail('The setlist changed. Refresh and retry the move.')
  if (!matches(await live(tools, roomId))) return stale()
  try {
    await tools.update('rooms', roomId, { trackOrder: ids })
  } catch {
    // A lost reply can follow a committed write. Never replay this order.
  }
  if (!matches(await live(tools, roomId))) {
    await reconcile(tools, roomId)
    return stale()
  }
  if (!same(await order(tools, roomId), ids)) return fail('Order unconfirmed. Refresh and retry the move.')
  return { success: true as const, data: { roomId } }
}

const keysByOperation = {
  add: ['roomId', 'track'],
  update: ['roomId', 'trackId', 'patch'],
  delete: ['roomId', 'trackId'],
  reorder: ['roomId', 'orderedTrackIds'],
}
type Operation = keyof typeof keysByOperation
function action(op: Operation): ActionHandler<Env> {
  return async ({ userId, callerJwt, params, tools }) => {
    if (!userId?.trim() || userId.startsWith('anon-') || !callerJwt?.trim()) return fail('Authentication required.')
    const keys = keysByOperation[op]
    if (!object(params) || Object.keys(params).length !== keys.length || !keys.every(k => Object.hasOwn(params, k))) return fail('Invalid track request.')
    const { roomId, trackId, orderedTrackIds } = params
    if (!id(roomId) || (keys.includes('trackId') && !id(trackId))) return fail('Invalid identifier.')
    if (op === 'reorder' && (!Array.isArray(orderedTrackIds) || orderedTrackIds.length > capacity ||
      !orderedTrackIds.every(id) || new Set(orderedTrackIds).size !== orderedTrackIds.length)) return fail('Invalid track order.')
    const fields = op === 'add' || op === 'update' ? trackFields(op === 'add' ? params.track : params.patch, op === 'add') : {}
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
      if (op === 'reorder') return await reorder(tools, roomId, orderedTrackIds as string[])
      if (op === 'add') return await allocate(tools, roomId, userId, fields)
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
export const reorderTracks = action('reorder')
