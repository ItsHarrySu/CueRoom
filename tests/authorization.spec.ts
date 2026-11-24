import { expect, loadAllTestAccounts, test } from 'deepspace/testing'
import { storedRoom } from './helpers/stored-room'
import type { Page } from '@playwright/test'
import type { act } from '../src/cueroom/data'
import type { observe } from './helpers/records'

test.skip(loadAllTestAccounts().length < 3, 'Requires three usable DeepSpace test accounts.')
test.setTimeout(120_000)

async function action(page: Page, name: Parameters<typeof act>[0], params: Record<string, unknown>) {
  return page.evaluate(async ({ name, params }) => {
    const path = '/src/cueroom/data.ts'
    const module: { act: typeof act } = await import(path)
    return module.act(name, params)
  }, { name, params })
}

async function records(page: Page, collection: string, roomId: string) {
  const handle = await page.evaluateHandle(async ({ collection, roomId }) => {
    const path = '/tests/helpers/records.tsx'
    const module: { observe: typeof observe } = await import(path)
    return module.observe(collection, roomId)
  }, { collection, roomId })
  await expect.poll(() => handle.evaluate(s => s.current?.ready)).toBe(true)
  return handle
}

test('private track subscriptions and action authorization', async ({ users }) => {
  const [a, b, c] = await users(3)
  for (const user of [a, b, c]) {
    await user.page.goto('/home')
    await expect(user.page.getByRole('heading', { name: 'Your rooms' })).toBeVisible()
  }
  const { roomId } = await action(a.page, 'createRoom', { name: 'Private rehearsal' })
  const { roomId: other } = await action(c.page, 'createRoom', { name: 'Independent rehearsal' })
  if (!roomId || !other) throw Error('Missing confirmed room ID')
  const hidden = await records(c.page, 'tracks', roomId)
  const roomObserver = await c.context.newPage()
  await roomObserver.goto('/home')
  const hiddenRoom = await records(roomObserver, 'rooms', roomId)
  await expect.poll(() => hiddenRoom.evaluate(s => s.status)).toBe('ready')
  const visible = await records(a.page, 'tracks', roomId)
  await expect.poll(() => hidden.evaluate(s => s.status)).toBe('ready')
  const track = { title: 'First take', artist: 'Test artist' }
  const { trackId } = await action(a.page, 'addTrack', { roomId, track })
  if (!trackId) throw Error('Missing confirmed track ID')
  await expect.poll(() => visible.evaluate(s => s.ids)).toEqual([trackId])
  const before = storedRoom(roomId)
  const target = { roomId, trackId }
  await expect(action(c.page, 'addTrack', { roomId, track })).rejects.toThrow('Room access denied')
  await expect(action(c.page, 'updateTrack', { ...target, patch: track })).rejects.toThrow('Room access denied')
  await expect(action(c.page, 'deleteTrack', target)).rejects.toThrow('Room access denied')
  await expect(action(c.page, 'reorderTracks', { roomId, orderedTrackIds: [trackId] })).rejects.toThrow('Room access denied')
  await expect(action(c.page, 'updateTrack', { roomId: other, trackId, patch: { title: 'Changed' } })).rejects.toThrow('Track unavailable')
  await expect(action(c.page, 'deleteTrack', { roomId: other, trackId })).rejects.toThrow('Track unavailable')
  await expect(action(c.page, 'createRoom', { name: 'Invalid', ownerId: a.userId ?? 'other' })).rejects.toThrow('Invalid room name')
  await expect(action(c.page, 'addTrack', { roomId, track, userId: a.userId ?? 'other' })).rejects.toThrow('Invalid track request')
  await a.page.goto('/rooms/' + roomId)
  await expect(a.page.locator('.track-info strong')).toHaveText(['First take'])
  expect(storedRoom(roomId)).toEqual(before)
  expect(await hidden.evaluate(s => [...s.seen])).toEqual([])
  expect(await hiddenRoom.evaluate(s => [...s.seen])).toEqual([])
})

for (const collection of ['rooms', 'tracks', 'team_members']) {
  test('authenticated direct writes are refused for ' + collection, async ({ users }) => {
    const [member] = await users(1)
    const page = member.page
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: 'Your rooms' })).toBeVisible()
    const { roomId } = await action(page, 'createRoom', { name: 'Write check' })
    if (!roomId) throw Error('Missing confirmed room ID')
    const track = { title: 'Original', artist: 'Test artist' }
    const { trackId } = await action(page, 'addTrack', { roomId, track })
    if (!trackId) throw Error('Missing confirmed track ID')
    const handle = await records(page, collection, roomId)
    const userId = await handle.evaluate(s => s.userId)
    const data = collection === 'rooms' ? { roomId: crypto.randomUUID(), ownerId: userId, inviteToken: crypto.randomUUID(), name: 'New', trackOrder: [] }
      : collection === 'tracks' ? { roomId, ...track, addedBy: userId, capacitySlot: 1, creationToken: crypto.randomUUID() }
      : { teamId: crypto.randomUUID(), userId, status: 'active' }
    const before = storedRoom(roomId)
    expect(before.members).toHaveLength(1)
    const id = collection === 'rooms' ? roomId : collection === 'tracks' ? trackId : String(before.members[0]._row_id)
    const patch = collection === 'rooms' ? { name: 'Changed' } : collection === 'tracks' ? { title: 'Changed' } : { status: 'active' }
    const denied = /permission|forbidden|not allowed|unauthorized|denied/i
    await expect(handle.evaluate((s, data) => s.current!.createConfirmed(data), data)).rejects.toThrow(denied)
    await expect(handle.evaluate((s, { id, patch }) => s.current!.putConfirmed(id, patch), { id, patch })).rejects.toThrow(denied)
    await expect(handle.evaluate((s, id) => s.current!.removeConfirmed(id), id)).rejects.toThrow(denied)
    expect(storedRoom(roomId)).toEqual(before)
    await page.goto('/rooms/' + roomId)
    await expect(page.getByRole('heading', { name: 'Write check' })).toBeVisible()
    await expect(page.locator('.track-info strong')).toHaveText(['Original'])
  })
}

test('capacity, stale orders and overlapping operations preserve the live set', async ({ users }) => {
  test.setTimeout(300_000)
  const [a] = await users(1)
  const page = a.page
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Your rooms' })).toBeVisible()
  const { roomId } = await action(page, 'createRoom', { name: 'Capacity rehearsal' })
  if (!roomId) throw Error('Missing confirmed room ID')
  const add = (title: string) => action(page, 'addTrack', { roomId, track: { title, artist: 'DJ' } })
  const move = (orderedTrackIds: string[]) => action(page, 'reorderTracks', { roomId, orderedTrackIds })
  await expect(action(page, 'addTrack', {})).rejects.toThrow('Invalid track request')
  await expect(add('')).rejects.toThrow('Invalid track fields')
  const ids: string[] = []
  for (let n = 0; n < 200; n++) {
    const { trackId } = await add('Track ' + n)
    if (!trackId) throw Error('Missing confirmed track ID')
    ids.push(trackId)
  }
  await expect(add('Overflow')).rejects.toThrow('Room track limit reached')
  await expect(move(ids.slice(1))).rejects.toThrow('setlist changed')
  await expect(move([ids[1], ...ids.slice(1)])).rejects.toThrow('Invalid track order')
  const reverse = ids.slice().reverse()
  const moves = await Promise.allSettled([move(reverse), move(ids)])
  expect(moves.some(r => r.status === 'fulfilled')).toBe(true)
  for (const result of moves) {
    if (result.status === 'rejected') expect(String(result.reason)).toMatch(/busy|unconfirmed/i)
  }
  const accepted = [reverse, ids].filter((_, index) => moves[index].status === 'fulfilled')
  expect(accepted).toContainEqual(storedRoom(roomId).order)
  const [removed, added, reordered] = await Promise.allSettled([
    action(page, 'deleteTrack', { roomId, trackId: ids[0] }), add('Replacement'), move(reverse),
  ])
  if (removed.status === 'rejected') {
    expect(String(removed.reason)).toMatch(/busy/i)
    await action(page, 'deleteTrack', { roomId, trackId: ids[0] })
  }
  if (reordered.status === 'rejected') expect(String(reordered.reason)).toMatch(/busy|changed|unconfirmed/i)
  if (added.status === 'rejected') {
    expect(String(added.reason)).toMatch(/busy|limit/i)
    await add('Replacement')
  }
  await page.goto('/rooms/' + roomId)
  const titles = page.locator('.track-info strong')
  await expect(titles).toHaveCount(200)
  expect((await titles.allTextContents()).sort()).toEqual([
    ...ids.slice(1).map((_, n) => 'Track ' + (n + 1)), 'Replacement',
  ].sort())
  const stored = storedRoom(roomId)
  expect(stored.order.slice().sort()).toEqual(stored.tracks.map(row => String(row._row_id)).sort())
  const finalOrder = await titles.allTextContents()
  await page.reload()
  await expect(titles).toHaveText(finalOrder)
})

test('room ownership alone cannot enable paid email', async ({ users }) => {
  const [member] = await users(1)
  const page = member.page
  await page.goto('/home')
  const { roomId } = await action(page, 'createRoom', {name:'Settings boundary'})
  await page.goto('/rooms/' + roomId)
  await expect(page.getByRole('button',{name:'Email invitations disabled'})).toBeDisabled()
  const status = await page.evaluate(async () => {
    const path = '/tests/helpers/settings.ts'
    return (await import(path)).attemptToggle()
  })
  expect(status).toBe(403)
})

test('authenticated room owner retains free advice with AI disabled', async ({users}) => {
  const [member] = await users(1)
  const page = member.page
  await page.goto('/home')
  const {roomId} = await action(page,'createRoom',{name:'Free preview'})
  for (const title of ['Intro','Outro']) await action(page,'addTrack',{roomId,track:{title,artist:'Sample',bpm:120}})
  await page.goto('/rooms/'+roomId)
  await expect(page.getByRole('button',{name:'Generate paid AI recommendation'})).toBeDisabled()
  await page.getByRole('button',{name:'Suggest transitions'}).click()
  await expect(page.getByText('Both tracks are at 120 BPM. Try a beatmatched transition.')).toBeVisible()
})
