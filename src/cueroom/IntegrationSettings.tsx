import { useEffect, useState } from 'react'
import { getAuthToken } from 'deepspace'

type Feature = 'email' | 'ai'
type Status = { owner: boolean; preferences?: Record<Feature, boolean>; email: boolean; ai: boolean }
async function settings(change?: { feature: Feature; enabled: boolean }): Promise<Status> {
  const token = await getAuthToken()
  if (!token) throw Error('Sign in required')
  const res = await fetch('/api/cueroom/settings', {
    method: change ? 'PUT' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: change && JSON.stringify(change),
  })
  if (!res.ok) throw Error('Settings unavailable')
  return res.json()
}
export function useIntegrationStatus() {
  const [status, set] = useState<Status>()
  const [error, fail] = useState(false)
  useEffect(() => {
    let active = true
    settings().then(value => { if (active) set(value) }).catch(() => { if (active) fail(true) })
    return () => { active = false }
  }, [])
  return {status, set, error}
}
export function IntegrationSettings() {
  const {status, set, error} = useIntegrationStatus()
  const [busy, pending] = useState(false)
  const [message, report] = useState('')
  if (error) return <p role="status">Integration settings unavailable.</p>
  if (!status?.owner) return null
  return <section><h2>Integration settings</h2>{(['email','ai'] as const).map(feature =>
    <label key={feature}><input type="checkbox" disabled={busy} checked={status.preferences?.[feature] === true}
      onChange={async event => {
        pending(true)
        try { set(await settings({feature, enabled: event.target.checked})); report('Saved.') }
        catch { report('Could not confirm setting. Reload to verify.') }
        finally { pending(false) }
      }} />{feature === 'ai' ? 'AI recommendations' : 'Email invitations'} · {status[feature] ? 'Available' : 'Disabled'}</label>)}
    <p role="status">{message}</p></section>
}
