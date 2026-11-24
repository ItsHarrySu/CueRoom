import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuthStatus, useMutations, useQuery, type RecordData } from 'deepspace'
import { ArrowUp, ArrowDown, Grid2X2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
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

import { InvitationEmail } from '@/cueroom/InvitationEmail'
import { TransitionPreview } from '@/cueroom/TransitionPreview'
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
  const auth = useAuthStatus()
  const rooms = useQuery<Room>('rooms')
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
  const count = String(stats.count).padStart(2, '0')
  const addTrack = <Button disabled={moving || rows.length >= 200 || query.status !== 'ready'}
    onClick={() => setEdit({ kind: 'add' })}><Plus />Add track</Button>
  return (
    <section className="room-workspace" data-pane={pane}>
      <nav className="room-rail" aria-label="Room navigation">
        <div className="rail-brand"><Grid2X2 size={18} />CueRoom</div>
        <small>Workspace</small><Link to="/home">All rooms</Link>
        <small>Your rooms</small><strong aria-current="page">{room.name}</strong>
        {rooms.status === 'ready' && rooms.records.filter(validRoom).filter(r => r.recordId !== roomId).map(r =>
          <Link key={r.recordId} to={'/rooms/' + r.recordId}>{r.data.name}</Link>)}
        <div className="rail-collab"><small>Collaboration</small>
          <button disabled={!uuid.test(room.inviteToken)} onClick={share}>Invite a DJ</button>
          <p>Share this room with a collaborator.</p>
        </div>
      </nav>
      <div className="room-center">
      <div className="room-crumb"><Link to="/home">Rooms</Link> / <span>{room.name}</span></div>
      <header className="room-heading">
        <div><h1>{room.name}</h1><p>Shared setlist workspace</p></div>
        <div className="room-actions">
          {auth.userId && auth.userId === room.ownerId && <InvitationEmail roomId={roomId} />}
          <Button disabled={!uuid.test(room.inviteToken)} variant="outline" onClick={share} aria-label="Copy invitation">
            <span className="desktop-invite">Copy invitation</span><span className="mobile-invite">Invite</span>
          </Button>
          <div className="desktop-add">{addTrack}</div>
        </div>
      </header>
      {query.status === 'ready' && <>
        <dl className="set-summary">
          <div><dt>Tracks</dt><dd>{count}</dd></div>
          <div><dt>Avg BPM</dt><dd>{stats.average === null ? 'Unavailable' : Number(stats.average.toFixed(1))}</dd></div>
          <div><dt>BPM range</dt><dd>{stats.range?.join('–') ?? 'Unavailable'}</dd></div>
        </dl>
        <div className="pane-switch" role="group" aria-label="Workspace view">
          <button aria-pressed={pane === 'order'} aria-controls="running-order" onClick={() => setPane('order')}>Running order</button>
          <button aria-pressed={pane === 'insights'} aria-controls="set-insights" onClick={() => setPane('insights')}>Set insights</button>
        </div>
      </>}
      <div id="running-order" className="order-sheet" data-ready={query.status === 'ready'}>
        <header className="sheet-head">
          <div><h2>Running order</h2><p>Arrange your transitions before the first cue.</p></div>
          {query.status === 'ready' && (
            <span className="meta">
              {count} / 200
            </span>
          )}
        </header>
        <ReadState {...query} />
        {query.status === 'ready' &&
          (rows.length ? (
            <>
            <div className="track-columns" aria-hidden="true"><span>#</span><span>Track</span><span>Tempo</span><span>Key</span><span>Energy</span></div>
            <ol>
              {rows.map((row, i) => (
                <li className="order-track" data-selected={i === selected} key={row.recordId}>
                  <span className="meta">{String(i + 1).padStart(2, '0')}</span>
                  <button className="track-info text-left" aria-pressed={selected === i}
                    aria-label={'Select ' + row.data.title + ' for transition analysis'}
                    onClick={() => selectTrack(row.recordId)}>
                    <strong>{row.data.title}</strong>
                    <span className="text-muted-foreground">{row.data.artist}</span>
                  </button>
                  <span className="tempo">{validBpm(row.data.bpm) ? row.data.bpm : '—'} <small>BPM</small></span>
                  <span className="track-key" aria-label={'Key ' + (row.data.musicalKey || 'unavailable')}>{row.data.musicalKey || '—'}</span>
                  <span className="track-energy" aria-label={'Energy ' + (energyLevel(row.data.energy) ?? 'unavailable')}>
                    <small>Energy</small>{energyLevel(row.data.energy) === null ? '—' : [1,2,3,4,5].map(n =>
                      <i key={n} data-filled={n <= row.data.energy!} />)}
                  </span>
                  <details className="track-actions" name="track-actions">
                    <summary aria-label={'Actions for ' + row.data.title}><MoreHorizontal size={17} /></summary>
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
                  </details>
                </li>
              ))}
            </ol><p className="order-help">Select a track to inspect its transition. Open its actions to edit or reorder.</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">An open setlist</h2>
              <p>Add the opening track to start planning this set.</p>
            </>
          ))}
      </div>
      </div>
      <div className="mobile-add"><div><small>{room.name}</small>{query.status === 'ready' && <b>{count} tracks</b>}</div>{addTrack}</div>
      {query.status === 'ready' && <SetInsights tracks={tracks} selected={selected}>
        {auth.userId && auth.userId === room.ownerId && <TransitionPreview key={JSON.stringify(rows.map(row => [row.recordId, row.data.bpm, row.data.title, row.data.artist, row.data.energy, row.data.musicalKey])) + selected}
          roomId={roomId} pair={rows.slice(Math.max(0, Math.min(selected, rows.length - 2))).slice(0, 2)} />}
      </SetInsights>}
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
