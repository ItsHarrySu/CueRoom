import { useState } from 'react'
import type { RecordData } from 'deepspace'
import { act, type Track } from './data'

export function TransitionPreview({ roomId, pair }: { roomId: string; pair: RecordData<Track>[] }) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  async function suggest() {
    setBusy(true)
    setFeedback('')
    try {
      const result = await act('previewTransition', { roomId, fromId: pair[0].recordId, toId: pair[1].recordId })
      setFeedback(result.advice!)
    } catch {
      setFeedback('Preview unavailable. Refresh the setlist or retry.')
    } finally {
      setBusy(false)
    }
  }
  return <section><h3>Setlist advisor</h3>
    <p>Free tempo preview for one transition. Paid AI generation is disabled pending review.</p>
    {pair.length === 2 ? <><p>{pair[0].data.title} → {pair[1].data.title}</p>
      <button disabled={busy} onClick={suggest}>{busy ? 'Checking transition…' : 'Suggest transitions'}</button>
    </> : <p>Add two tracks to preview a transition.</p>}
    <p role="status">{feedback}</p>
  </section>
}
