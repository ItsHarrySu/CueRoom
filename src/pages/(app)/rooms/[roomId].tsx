import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuthStatus, useMutations, useQuery, type RecordData } from 'deepspace'
import { ArrowUp, ArrowDown, Link2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Modal, useToast } from '@/components/ui'
import {
  act,
  invitation,
  orderedTracks,
  pendingInvite,
  uuid,
  validRoom,
  type Room,
  type Track,
} from '@/cueroom/data'
import { ActionForm, ReadState, SignIn } from '@/cueroom/UI'

import { SetInsights } from '@/cueroom/SetInsights'
import { summarize, validBpm, energyLevel } from '@/cueroom/insights'

export default function RoomPage() {
  const { roomId = '' } = useParams()
  const { hash, search } = useLocation()
  const auth = useAuthStatus()
  const [revision, setRevision] = useState(0)
  if (!uuid.test(roomId)) return <Unavailable />
  if (hash || search) {
    try {
      const params = invitation('/rooms/' + roomId + search + hash, '', location.origin)
      return <Invite key={roomId + hash} {...params} signedIn={auth.isSignedIn} />
    } catch {
      return <Unavailable invite />
    }
  }
  return auth.isSignedIn ? (
    <RoomReader
      key={auth.userId + roomId + revision}
      roomId={roomId}
      refresh={() => setRevision((n) => n + 1)}
    />
  ) : (
    <SignIn />
  )
}

function Unavailable({ invite = false }: { invite?: boolean }) {
  return (
    <section className="studio">
      <h1>{invite ? 'Invalid invitation' : 'Room unavailable'}</h1>
      <p>Ask a room member for a fresh invitation.</p>
      <Link className="underline" to="/home">
        Back to rooms
      </Link>
    </section>
  )
}
function Invite({
  roomId,
  inviteToken,
  signedIn,
}: {
  roomId: string
  inviteToken: string
  signedIn: boolean
}) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!signedIn)
      sessionStorage.setItem(pendingInvite, '/rooms/' + roomId + '#invite=' + inviteToken)
  }, [signedIn, roomId, inviteToken])
  if (!signedIn) return <SignIn invite />
  return (
    <section className="studio">
      <div className="panel max-w-md">
        <h1>Room invitation</h1>
        <p>Accept to open the shared setlist.</p>
        <ActionForm
          label="Accept invitation"
          submit={async () => {
            await act('joinRoom', { roomId, inviteToken })
            sessionStorage.removeItem(pendingInvite)
            navigate('/rooms/' + roomId, { replace: true })
          }}
        />
        <Link
          className="mt-4 block underline"
          to="/home"
          onClick={() => sessionStorage.removeItem(pendingInvite)}
        >
          Back to rooms
        </Link>
      </div>
    </section>
  )
}
function RoomReader({ roomId, refresh }: { roomId: string; refresh: () => void }) {
  const query = useQuery<Room>('rooms', { where: { roomId } })
  if (query.status !== 'ready')
    return (
      <div className="studio">
        <ReadState {...query} />
      </div>
    )
  const room = query.records.find((r) => r.recordId === roomId && validRoom(r))
  return room ? <Editor room={room.data} refresh={refresh} /> : <Unavailable />
}
type Edit = { kind: 'add' } | { kind: 'edit' | 'delete'; row: RecordData<Track> }

function Editor({ room, refresh }: { room: Room; refresh: () => void }) {
  const { roomId } = room
  const query = useQuery<Track>('tracks', { where: { roomId }, limit: 201 })
  const rows = orderedTracks(query.records, room)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [selectedId, selectTrack] = useState<string | null>(null)
  const [pane, setPane] = useState<'order' | 'insights'>('order')
  const selected = Math.max(0, rows.findIndex(row => row.recordId === selectedId))
  const tracks = rows.map(row => row.data)
  const stats = summarize(tracks)
  const toast = useToast()
  const [moving, setMoving] = useState(false)
  const { ready } = useMutations('tracks')
  async function move(index: number, destination: number) {
    if (!ready || moving || destination < 0 || destination >= rows.length) return
    const orderedTrackIds = rows.map((row) => row.recordId)
    orderedTrackIds.splice(destination, 0, ...orderedTrackIds.splice(index, 1))
    setMoving(true)
    try {
      await act('reorderTracks', { roomId, orderedTrackIds })
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Order unconfirmed.',
        'Refreshing the setlist before retry.',
      )
    } finally {
      refresh()
    }
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(
        location.origin + '/rooms/' + roomId + '#invite=' + room.inviteToken,
      )
      toast.success('Invitation copied')
    } catch {
      toast.error('Clipboard access failed. Allow clipboard access and try again.')
    }
  }
  return (
    <section className="studio room-workspace" data-pane={pane}>
      <nav className="room-rail" aria-label="Room navigation">
        <Link to="/home">← Your rooms</Link>
        <strong aria-current="page">{room.name}</strong>
      </nav>
      <div className="section-head mt-4">
        <div>
          <span className="caption">Setlist workspace</span>
          <h1>{room.name}</h1>
        </div>
        <div className="tools">
          <Button disabled={!uuid.test(room.inviteToken)} variant="outline" onClick={share}>
            <Link2 />
            Copy invitation
          </Button>
          <Button
            disabled={moving || rows.length >= 200 || query.status !== 'ready'}
            onClick={() => setEdit({ kind: 'add' })}
          >
            <Plus />
            Add track
          </Button>
        </div>
      </div>
      {query.status === 'ready' && <>
        <dl className="set-summary">
          <div><dt>Tracks</dt><dd>{stats.count} <small>/ 200</small></dd></div>
          <div><dt>Average BPM</dt><dd>{stats.average === null ? 'Unavailable' : Number(stats.average.toFixed(1))}</dd></div>
          <div><dt>BPM range</dt><dd>{stats.range?.join('–') ?? 'Unavailable'}</dd></div>
        </dl>
        <div className="pane-switch" role="group" aria-label="Workspace view">
          <button aria-pressed={pane === 'order'} aria-controls="running-order" onClick={() => setPane('order')}>Running order</button>
          <button aria-pressed={pane === 'insights'} aria-controls="set-insights" onClick={() => setPane('insights')}>Set insights</button>
        </div>
      </>}
      <div id="running-order" className="panel sheet" data-ready={query.status === 'ready'}>
        <header className="sheet-head">
          <h2>Running order</h2>
          {query.status === 'ready' && (
            <span className="meta">
              {rows.length} {rows.length === 1 ? 'track' : 'tracks'}
            </span>
          )}
        </header>
        <ReadState {...query} />
        {query.status === 'ready' &&
          (rows.length ? (
            <ol>
              {rows.map((row, i) => (
                <li className="track-row" data-selected={i === selected} key={row.recordId}>
                  <span className="meta">{String(i + 1).padStart(2, '0')}</span>
                  <button className="track-info text-left" aria-pressed={selected === i}
                    aria-label={'Select ' + row.data.title + ' for transition analysis'}
                    onClick={() => selectTrack(row.recordId)}>
                    <strong>{row.data.title}</strong>
                    <span className="text-muted-foreground">{row.data.artist}</span>
                  </button>
                  <div className="track-details">
                    <span>{validBpm(row.data.bpm) ? row.data.bpm : '—'} BPM</span>
                    <span className="recorded-key">Key {row.data.musicalKey || '—'}</span>
                    <span>Energy {energyLevel(row.data.energy) ?? '—'}/5</span>
                  </div>
                  <div className="row-tools">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={'Move ' + row.data.title + ' up'}
                      disabled={moving || !ready || i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={'Move ' + row.data.title + ' down'}
                      disabled={moving || !ready || i === rows.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      disabled={moving}
                      size="icon"
                      variant="ghost"
                      aria-label={'Edit ' + row.data.title}
                      onClick={() => setEdit({ kind: 'edit', row })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      disabled={moving}
                      size="icon"
                      variant="ghost"
                      aria-label={'Delete ' + row.data.title}
                      onClick={() => setEdit({ kind: 'delete', row })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <>
              <h2 className="text-xl font-semibold">An open setlist</h2>
              <p>Add the opening track to start planning this set.</p>
            </>
          ))}
      </div>
      {query.status === 'ready' && <SetInsights tracks={tracks} selected={selected} />}
      {edit && (
        <TrackDialog edit={edit} roomId={roomId} close={() => setEdit(null)} refresh={refresh} />
      )}
    </section>
  )
}

function TrackDialog({
  edit,
  roomId,
  close,
  refresh,
}: {
  edit: Edit
  roomId: string
  close: () => void
  refresh: () => void
}) {
  const toast = useToast()
  const track = edit.kind === 'add' ? undefined : edit.row.data
  const label =
    edit.kind === 'delete' ? 'Delete track' : edit.kind === 'edit' ? 'Save changes' : 'Add track'
  async function submit(form: FormData) {
    if (edit.kind === 'delete') await act('deleteTrack', { roomId, trackId: edit.row.recordId })
    else {
      const value = (key: string) => String(form.get(key) ?? '').trim()
      const fields = {
        title: value('title'),
        artist: value('artist'),
        bpm: value('bpm') ? Number(value('bpm')) : null,
        musicalKey: value('musicalKey') || null,
        energy: value('energy') ? Number(value('energy')) : null,
      }
      if (edit.kind === 'add') await act('addTrack', { roomId, track: fields })
      else {
        const patch = Object.fromEntries(
          Object.entries(fields).filter(
            ([key, v]) => v !== (edit.row.data[key as keyof Track] ?? null),
          ),
        )
        if (Object.keys(patch).length)
          await act('updateTrack', { roomId, trackId: edit.row.recordId, patch })
      }
    }
    close()
  }
  return (
    <Modal open onClose={close}>
      <Modal.Title>{edit.kind === 'edit' ? 'Edit track' : label}</Modal.Title>
      <ActionForm
        label={label}
        submit={submit}
        onFailure={(message) => {
          toast.error(message, 'Refreshing the setlist. Check its current state before retrying.')
          refresh()
        }}
      >
        {edit.kind === 'delete' ? (
          <p>Remove “{track?.title}” from this setlist?</p>
        ) : (
          <>
            <label>
              Title
              <Input name="title" required maxLength={120} defaultValue={track?.title} />
            </label>
            <label>
              Artist
              <Input name="artist" required maxLength={120} defaultValue={track?.artist} />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label>
                BPM
                <Input
                  name="bpm"
                  type="number"
                  min={40}
                  max={240}
                  step="any"
                  defaultValue={track?.bpm ?? ''}
                />
              </label>
              <label>
                Key
                <Input name="musicalKey" maxLength={16} defaultValue={track?.musicalKey ?? ''} />
              </label>
              <label>
                Energy (1–5)
                <Input
                  name="energy"
                  type="number"
                  min={1}
                  max={5}
                  defaultValue={track?.energy ?? ''}
                />
              </label>
            </div>
          </>
        )}
      </ActionForm>
    </Modal>
  )
}
