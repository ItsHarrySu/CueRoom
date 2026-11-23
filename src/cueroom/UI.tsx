import { useState, type FormEvent, type ReactNode } from 'react'
import { AuthOverlay } from 'deepspace'
import { Button } from '@/components/ui'

export function SignIn({ invite = false }: { invite?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="studio access-panel">
      <h1>{invite ? 'Join this room' : 'Your workspace'}</h1>
      <p>Sign in to {invite ? 'accept your invitation.' : 'open your rooms and plan a set.'}</p>
      <Button onClick={() => setOpen(true)}>Sign in to CueRoom</Button>
      {open && <AuthOverlay title="Sign in to CueRoom" onClose={() => setOpen(false)} />}
    </section>
  )
}
export function ActionForm({
  children,
  label,
  submit,
  onFailure,
}: {
  children?: ReactNode
  label: string
  submit: (data: FormData) => Promise<void>
  onFailure?: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await submit(data)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to confirm the request.'
      setError(message)
      onFailure?.(message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={handle} className="grid gap-4">
      <fieldset disabled={busy} className="grid gap-4">
        {children}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <Button loading={busy} type="submit">
        {label}
      </Button>
    </form>
  )
}
export function ReadState({ status, error }: { status: string; error?: string }) {
  if (status === 'ready') return null
  return (
    <p className="read-state" role="status">
      {status === 'loading'
        ? 'Loading workspace…'
        : /denied|forbidden|permission|unauthor/i.test(error ?? '')
          ? 'You do not have access to this room.'
          : 'Unable to load records. Refresh to try again.'}
    </p>
  )
}
