import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import { DeepSpaceAuthProvider, RecordProvider, RecordScope, useAuthStatus, useMutations, useQuery } from 'deepspace'
import { schemas } from '../../src/schemas'
import { SCOPE_ID } from '../../src/constants'

// Mounted by Playwright through the local Vite server. Uses the current browser session.
export function observe(collection: string, roomId: string) {
  const node = document.createElement('div')
  document.body.appendChild(node)
  const root = createRoot(node)
  const state = { current: undefined as ReturnType<typeof useMutations> | undefined, ids: [] as string[], status: 'loading', userId: '', seen: new Set<string>() }
  function Probe() {
    const auth = useAuthStatus()
    const writes = useMutations(collection)
    const query = useQuery(collection, { where: collection === 'team_members' ? { teamId: roomId } : { roomId } })
    useEffect(() => {
      state.current = writes
      state.userId = auth.userId ?? ''
      state.ids = query.records.map(row => row.recordId)
      for (const id of state.ids) state.seen.add(id)
      state.status = query.status
    }, [writes, auth.userId, query.records, query.status])
    return null
  }
  function Scope() {
    const auth = useAuthStatus()
    return auth.isSignedIn ? <RecordProvider><RecordScope roomId={SCOPE_ID} schemas={schemas}><Probe /></RecordScope></RecordProvider> : null
  }
  root.render(<DeepSpaceAuthProvider><Scope /></DeepSpaceAuthProvider>)
  return state
}
