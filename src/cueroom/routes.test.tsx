import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui'
import Home from '../pages/(app)/home'
import Room from '../pages/(app)/rooms/[roomId]'

const sdk = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }))
vi.mock('deepspace', () => ({ useAuthStatus: sdk.auth, useQuery: sdk.query, useMutations: () => ({ ready: true }) }))
const id = '90e2d389-8b7d-4cdd-8304-fc9751e16021'
const path = '/rooms/' + id
function page(url: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/rooms/:roomId" element={<Room />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://test.example' })
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  sdk.auth.mockReturnValue({ isSignedIn: true, userId: 'a' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})
it('offers sign-in without querying private records', () => {
  sdk.auth.mockReturnValue({ isSignedIn: false })
  expect(page('/home')).toContain('Sign in to CueRoom')
  expect(page(path)).toContain('Sign in to CueRoom')
  expect(sdk.query).not.toHaveBeenCalled()
})
it('withholds room and track queries until a valid invite is accepted', () => {
  expect(page(path + '#invite=' + id)).toContain('Accept invitation')
  expect(page(path + '#invite=bad')).toContain('Invalid invitation')
  expect(sdk.query).not.toHaveBeenCalled()
})
it('distinguishes loading, empty and denied room states', () => {
  sdk.query.mockReturnValue({ status: 'loading', records: [] })
  expect(page('/home')).toContain('Loading workspace')
  sdk.query.mockReturnValue({ status: 'ready', records: [] })
  expect(page('/home')).toContain('Your first set')
  expect(page(path)).toContain('Room unavailable')
  sdk.query.mockReturnValue({ status: 'error', error: 'Permission denied', records: [] })
  expect(page(path)).toContain('do not have access')
  expect(sdk.query.mock.calls.every(([collection]) => collection === 'rooms')).toBe(true)
})

it('renders move controls in subscribed room order with the boundaries disabled', () => {
  const room = { recordId: id, data: { roomId: id, name: 'Set', trackOrder: ['b', 'a'] } }
  const tracks = ['a', 'b'].map(key => ({ recordId: key, data: { roomId: id, title: key, artist: 'DJ' } }))
  sdk.query.mockImplementation(collection => ({ status: 'ready', records: collection === 'rooms' ? [room] : tracks }))
  const html = page(path)
  const buttons = html.match(/<button[^>]*aria-label="Move [^"]+"[^>]*>/g) ?? []
  expect(buttons.map(tag => tag.match(/aria-label="([^"]+)"/)?.[1])).toEqual(['Move b up', 'Move b down', 'Move a up', 'Move a down'])
  expect(buttons.map(tag => tag.includes(' disabled=""'))).toEqual([true, false, false, true])
})
