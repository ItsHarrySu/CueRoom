/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import { storedRoom } from './helpers/stored-room'
import type { WebSocketRoute } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('API status page renders loading success and error states', async ({ users }) => {
  const [user] = await users(1)
  let shouldFail = false
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    if (shouldFail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
      })
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()
  await expect(user.page.getByText('2 integrations available.')).toBeVisible()

  shouldFail = true
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect(user.page.getByText('Catalog unavailable')).toBeVisible()
  await expect(user.page.getByText('Showing the last loaded catalog')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('API status page shows local retry after first-load API failure', async ({ users }) => {
  const [user] = await users(1)
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Could not load API data')).toBeVisible()
  await expect(user.page.getByText('Retried 1 time automatically.')).toBeVisible()

  const retryButton = user.page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('members see track changes and persist a keyboard reorder across sessions', async ({ users }) => {
  test.skip(usableTestAccounts < 3, 'Requires three distinct usable accounts for CR-009.')
  test.setTimeout(120_000)
  const [owner, member, outsider] = await users(3)
  expect(new Set([owner.email, member.email, outsider.email]).size).toBe(3)
  const a = owner.page
  const b = member.page
  await a.goto('/home')
  await a.getByRole('button', { name: 'Create room' }).click()
  const dialog = a.getByRole('dialog')
  await dialog.getByLabel('Room name').fill('Collaboration check')
  await dialog.getByRole('button', { name: 'Create room' }).click()
  await a.waitForURL('**/rooms/*')
  await a.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(a.url()).origin })
  await a.getByRole('button', { name: 'Copy invitation' }).click()
  const invite = await a.evaluate(() => navigator.clipboard.readText())
  const roomUrl = a.url()
  const roomPath = new URL(roomUrl).pathname
  const c = outsider.page
  await c.goto('/home')
  await expect(c.getByRole('heading', { name: 'Your rooms' })).toBeVisible()
  await expect(c.locator('.room-card').first().or(c.getByText('Your first set starts here'))).toBeVisible()
  await expect(c.locator('a[href="' + roomPath + '"]')).toHaveCount(0)
  await c.goto(roomUrl)
  await expect(c.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()
  await c.goto(roomUrl + '#invite=' + crypto.randomUUID())
  await c.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(c.getByRole('alert')).toHaveText('Invalid room invitation.')
  await c.goto(roomUrl)
  await expect(c.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()

  let disconnected = false
  const sockets = new Set<WebSocketRoute>()
  await b.routeWebSocket(url => /^\/ws\/[^/]+$/.test(url.pathname), async socket => {
    if (disconnected) {
      await socket.close({ code: 1012 })
      return
    }
    const server = socket.connectToServer()
    sockets.add(socket)
    socket.onClose(async (code, reason) => {
      sockets.delete(socket)
      await server.close({ code, reason })
    })
  })
  await b.goto(invite)
  await b.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(b.getByText('An open setlist')).toBeVisible()

  await b.goto(invite)
  await b.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(b.getByText('An open setlist')).toBeVisible()

  const members = storedRoom(roomPath.split('/').pop()!).members
  expect(members).toHaveLength(2)
  expect(new Set(members.map(row => row.col_userid)).size).toBe(2)
  expect(members.every(row => row.col_status === 'active')).toBe(true)

  async function openActions(page: typeof a, title: string) {
    const actions = page.locator('details').filter({ has: page.getByLabel('Actions for ' + title, { exact: true }) })
    if (await actions.getAttribute('open') === null) await actions.locator('summary').click()
  }
  for (const title of ['Opening', 'Closing']) {
    await a.getByRole('button', { name: 'Add track' }).click()
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByLabel('Artist').fill('DJ')
    await dialog.getByRole('button', { name: 'Add track' }).click()
    if (title === 'Closing') await expect(b.getByRole('button', { name: 'Edit Opening' })).toBeVisible()
    await openActions(b, title)
    await expect(b.getByRole('button', { name: 'Edit ' + title })).toBeVisible()
  }
  await expect(b.getByRole('button', { name: 'Edit Opening' })).toBeHidden()
  const titles = (page: typeof a) => page.locator('.track-info strong')
  await openActions(b, 'Closing')
  await b.getByRole('button', { name: 'Move Closing up' }).press('Enter')
  for (const page of [a, b]) await expect(titles(page)).toHaveText(['Closing', 'Opening'])
  await Promise.all([a.reload(), b.reload()])
  for (const page of [a, b]) await expect(titles(page)).toHaveText(['Closing', 'Opening'])

  await openActions(a, 'Opening')
  await a.getByRole('button', { name: 'Edit Opening' }).click()
  await dialog.getByLabel('Title').fill('Encore')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(titles(b)).toHaveText(['Closing', 'Encore'])
  await openActions(b, 'Closing')
  await b.getByRole('button', { name: 'Delete Closing' }).click()
  await b.getByRole('dialog').getByRole('button', { name: 'Delete track' }).click()
  await expect(titles(a)).toHaveText(['Encore'])

  await b.getByRole('button', { name: 'Add track' }).click()
  const memberDialog = b.getByRole('dialog')
  await memberDialog.getByLabel('Title').fill('Interlude')
  await memberDialog.getByLabel('Artist').fill('DJ')
  await memberDialog.getByRole('button', { name: 'Add track' }).click()
  await expect(titles(a)).toHaveText(['Encore', 'Interlude'])
  await openActions(a, 'Interlude')
  await a.getByRole('button', { name: 'Move Interlude up' }).click()
  await expect(titles(b)).toHaveText(['Interlude', 'Encore'])
  await openActions(b, 'Encore')
  await b.getByRole('button', { name: 'Edit Encore' }).click()
  await memberDialog.getByLabel('Title').fill('Finale')
  await memberDialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(titles(a)).toHaveText(['Interlude', 'Finale'])

  disconnected = true
  expect(sockets.size).toBeGreaterThan(0)
  for (const socket of sockets) await socket.close({ code: 1012 })
  await openActions(a, 'Interlude')
  await a.getByRole('button', { name: 'Delete Interlude' }).click()
  await dialog.getByRole('button', { name: 'Delete track' }).click()
  await expect(titles(a)).toHaveText(['Finale'])
  disconnected = false
  await expect(titles(b)).toHaveText(['Finale'], { timeout: 30_000 })
  await Promise.all([a.reload(), b.reload()])
  for (const page of [a, b]) await expect(titles(page)).toHaveText(['Finale'])
  await expect(c.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()
})
