import { useIntegrationStatus } from './IntegrationSettings'
import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { act } from './data'

export function InvitationEmail({ roomId }: { roomId: string }) {
  const {status} = useIntegrationStatus()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmation, setConfirmation] = useState('')
  return <>
    <Button disabled={!status?.email} variant="outline" onClick={() => {
      setConfirmation(crypto.randomUUID())
      setMessage('')
      setOpen(true)
    }}>{status?.email ? 'Send invitation email' : 'Email invitations disabled'}</Button>
    {open && <Modal open onClose={() => { if (!busy) setOpen(false) }}>
      <Modal.Title>Invite by email</Modal.Title>
      <form className="grid gap-4" onSubmit={async event => {
        event.preventDefault()
        if (busy) return
        const recipient = new FormData(event.currentTarget).get('recipient')
        setBusy(true)
        setMessage('')
        try {
          await act('sendInvitationEmail', { roomId, recipient, confirmation })
          setMessage('Invitation accepted for delivery.')
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Invitation unavailable.')
        } finally {
          setBusy(false)
        }
      }}>
        <p>Invite one collaborator. They must sign in and accept the room invitation.</p>
        <label>Recipient email<Input type="email" name="recipient" required maxLength={254}
          disabled={busy} placeholder="dj@example.com" /></label>
        <p>Sending costs the app owner $0.013 per request.</p>
        <p role="status">{message}</p>
        <Button type="submit" disabled={busy}>{busy ? 'Checking invitation…' : 'Send invitation'}</Button>
      </form>
    </Modal>}
  </>
}
