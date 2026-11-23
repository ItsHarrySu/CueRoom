import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAuthToken, type RecordData } from 'deepspace'
import { act, invitation, orderedTracks, roomName, validRoom, type Track } from './data'
vi.mock('deepspace', () => ({ getAuthToken: vi.fn() }))
const roomId = '37d20ac0-a688-4ef4-aa98-157a77799a11'
const inviteToken = '90e2d389-8b7d-4cdd-8304-fc9751e16021'
const origin = 'https://test.example'
const path = '/rooms/' + roomId + '#invite=' + inviteToken
const room = { roomId, inviteToken, name: 'Studio', trackOrder: ['d', 'missing', 'd', 'b'] }
const row = (recordId: string): RecordData<Track> => ({
  recordId,
  data: { roomId, title: 'Track', artist: 'Artist' },
  createdBy: 'u',
  createdAt: '',
  updatedAt: '',
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})
describe('workspace data', () => {
  it('accepts a local invitation link and an ID/token pair', () => {
    expect(invitation(origin + path, '', origin)).toEqual({ roomId, inviteToken })
    expect(invitation(roomId, inviteToken, origin)).toEqual({ roomId, inviteToken })
  })
  it.each([
    'https://other.example' + path,
    path + 'bad',
    path + '&invite=' + inviteToken,
    '/rooms/nope',
    roomId,
  ])('rejects malformed or foreign invitations', (input) => {
    expect(() => invitation(input, '', origin)).toThrow()
  })
  it('trims names and enforces the server length', () => {
    expect(roomName(' Studio ')).toBe('Studio')
    expect(() => roomName('  ')).toThrow()
    expect(() => roomName('🎧'.repeat(81))).toThrow()
  })
  it('filters missing, malformed and foreign tracks and appends live IDs in ordinal order', () => {
    const foreign = row('other')
    foreign.data.roomId = 'other'
    expect(
      orderedTracks(
        [
          row('z'),
          row('a'),
          row('b'),
          row('d'),
          foreign,
          { ...row('bad'), data: null } as unknown as RecordData<Track>,
        ],
        room,
      ).map((r) => r.recordId),
    ).toEqual(['d', 'b', 'a', 'z'])
    expect(validRoom({ ...row('other'), data: room })).toBe(false)
  })
  it('requires an SDK credential before posting', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.mocked(getAuthToken).mockResolvedValue(null)
    await expect(act('joinRoom', { roomId, inviteToken })).rejects.toThrow('Sign in')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sends a bearer and requires an acknowledged action-specific response', async () => {
    vi.mocked(getAuthToken).mockResolvedValue('test-token')
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ success: true, data: { roomId } }))
      .mockResolvedValueOnce(Response.json({ success: false, error: 'Denied' }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { trackId: 'wrong' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(act('createRoom', { name: 'Studio' })).resolves.toEqual({ roomId })
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token')
    await expect(act('joinRoom', { roomId, inviteToken })).rejects.toThrow('Denied')
    await expect(act('deleteTrack', { roomId, trackId: 'track' })).rejects.toThrow('confirm')
  })
})
