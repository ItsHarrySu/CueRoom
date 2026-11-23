import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStatus, useQuery } from 'deepspace'
import { ArrowUpRight, Disc3, Plus } from 'lucide-react'
import { Button, Input, Modal } from '@/components/ui'
import { act, invitation, pendingInvite, roomName, validRoom, type Room } from '@/cueroom/data'
import { ActionForm, ReadState, SignIn } from '@/cueroom/UI'

export default function HomePage() {
  const auth = useAuthStatus()
  if (!auth.isSignedIn) return <SignIn />
  const pending = sessionStorage.getItem(pendingInvite)
  if (pending) {
    try {
      const { roomId, inviteToken } = invitation(pending, '', location.origin)
      return <Navigate replace to={'/rooms/' + roomId + '#invite=' + inviteToken} />
    } catch {
      sessionStorage.removeItem(pendingInvite)
    }
  }
  return <Dashboard key={auth.userId} />
}

function Dashboard() {
  const rooms = useQuery<Room>('rooms')
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'Create room' | 'Join room' | null>(null)
  const list = rooms.records.filter(validRoom)
  async function submit(data: FormData) {
    if (dialog === 'Create room') {
      const result = await act('createRoom', { name: roomName(String(data.get('name'))) })
      navigate('/rooms/' + result.roomId)
    } else {
      const params = invitation(
        String(data.get('input')),
        String(data.get('token') ?? ''),
        location.origin,
      )
      await act('joinRoom', params)
      navigate('/rooms/' + params.roomId)
    }
  }
  return (
    <section className="studio">
      <div className="section-head">
        <h1>Your rooms</h1>
        <div className="tools">
          <Button variant="outline" onClick={() => setDialog('Join room')}>
            Join room
          </Button>
          <Button onClick={() => setDialog('Create room')}>
            <Plus />
            Create room
          </Button>
        </div>
      </div>
      <ReadState {...rooms} />
      {rooms.status === 'ready' &&
        (list.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {list.map((r) => (
              <Link className="room-card" key={r.recordId} to={'/rooms/' + r.recordId}>
                <Disc3 aria-hidden />
                <strong className="flex-1">{r.data.name}</strong>
                <ArrowUpRight aria-hidden />
              </Link>
            ))}
          </div>
        ) : (
          <div className="panel">
            <h2 className="text-xl font-semibold">Your first set starts here</h2>
            <p>Create a room for your set, or join one with an invitation.</p>
          </div>
        ))}
      {dialog && (
        <Modal open onClose={() => setDialog(null)}>
          <Modal.Title>{dialog}</Modal.Title>
          <ActionForm label={dialog} submit={submit}>
            {dialog === 'Create room' ? (
              <label>
                Room name
                <Input name="name" required placeholder="Friday night residency" />
              </label>
            ) : (
              <>
                <label>
                  Invitation URL or room ID
                  <Input name="input" required autoComplete="off" />
                </label>
                <label>
                  Token (for room IDs)
                  <Input name="token" autoComplete="off" type="password" />
                </label>
              </>
            )}
          </ActionForm>
        </Modal>
      )}
    </section>
  )
}
