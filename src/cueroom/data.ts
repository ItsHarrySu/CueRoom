import { getAuthToken, type RecordData } from 'deepspace'

export const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
export const pendingInvite = 'cueroom.pending-invitation'

export function invitation(input: string, token: string, origin: string) {
  let roomId = input.trim()
  let inviteToken = token.trim()
  if (!uuid.test(roomId)) {
    const url = new URL(roomId, origin)
    const match = /^\/rooms\/([^/]+)$/.exec(url.pathname)
    const hash = new URLSearchParams(url.hash.slice(1))
    if (url.origin !== origin || !match || hash.getAll('invite').length !== 1 || url.search)
      throw Error('Enter a CueRoom invitation URL.')
    roomId = match[1]
    inviteToken = hash.get('invite') ?? ''
  }
  if (!uuid.test(roomId) || !uuid.test(inviteToken))
    throw Error('Enter a valid room ID and invitation token.')
  return { roomId, inviteToken }
}

export function roomName(value: string) {
  const name = value.trim()
  if (!name || [...name].length > 80) throw Error('Use 1–80 characters for the room name.')
  return name
}

export interface Room {
  ownerId?: string
  roomId: string
  name: string
  inviteToken: string
  trackOrder: unknown
}
export interface Track {
  roomId: string
  title: string
  artist: string
  bpm?: number | null
  musicalKey?: string | null
  energy?: number | null
}

export function validRoom(row: RecordData<Room>) {
  return (
    uuid.test(row.recordId) &&
    row.data?.roomId === row.recordId &&
    typeof row.data.name === 'string' &&
    !!row.data.name.trim()
  )
}

export function orderedTracks(rows: RecordData<Track>[], room: Room) {
  const live = new Map(
    rows
      .filter(
        (r) =>
          r.data?.roomId === room.roomId &&
          typeof r.data.title === 'string' &&
          typeof r.data.artist === 'string' &&
          r.recordId,
      )
      .map((r) => [r.recordId, r]),
  )
  const order = Array.isArray(room.trackOrder) ? room.trackOrder : []
  return [...new Set([...order, ...Array.from(live.keys()).sort()])].flatMap(
    (id) => live.get(id) ?? [],
  )
}

type Action = 'previewTransition' | 'createRoom' | 'joinRoom' | 'addTrack' | 'updateTrack' | 'deleteTrack' | 'reorderTracks'
export async function act(name: Action, params: Record<string, unknown>) {
  const token = await getAuthToken()
  if (!token) throw Error('Sign in again to continue.')
  const response = await fetch('/api/actions/' + name, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const result = (await response.json()) as {
    success?: unknown
    error?: unknown
    data?: { advice?: string; joined?: unknown; roomId?: string; trackId?: string }
  } | null
  if (!response.ok || result?.success !== true || result.error !== undefined)
    throw Error(
      typeof result?.error === 'string'
        ? result.error
        : 'The server could not confirm this change.',
    )
  const data = result.data
  const confirmed =
    name === 'previewTransition' ? typeof data?.advice === 'string' && data.advice.length > 0 && data.advice.length <= 256 :
    name === 'joinRoom'
      ? data?.joined === true
      : name === 'createRoom'
        ? typeof data?.roomId === 'string' && uuid.test(data.roomId)
        : name === 'reorderTracks'
          ? typeof data?.roomId === 'string' && data.roomId === params.roomId
          : typeof data?.trackId === 'string' &&
          !!data.trackId &&
          (name === 'addTrack' || data.trackId === params.trackId)
  if (!confirmed) throw Error('The server could not confirm this change.')
  return data!
}
