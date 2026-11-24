import { useIntegrationStatus } from './IntegrationSettings'
import { transitionMetadata, snapshotDigest } from './transition-snapshot'
import { useState } from 'react'
import type { RecordData } from 'deepspace'
import { act, type Track } from './data'

export function TransitionPreview({ roomId, pair }: { roomId: string; pair: RecordData<Track>[] }) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const {status} = useIntegrationStatus()
  async function suggest(paid = false) {
    setBusy(true)
    setFeedback('')
    try {
      const params = { roomId, fromId: pair[0].recordId, toId: pair[1].recordId }
      const result = paid ? await act('generateTransition', { ...params, confirmation: crypto.randomUUID(),
        snapshot: await snapshotDigest(pair.map(row => transitionMetadata(row.recordId,{...row.data}))) })
        : await act('previewTransition', params)
      setFeedback(result.advice!)
    } catch {
      setFeedback('Preview unavailable. Refresh the setlist or retry.')
    } finally {
      setBusy(false)
    }
  }
  return <section><h3>Setlist advisor</h3>
    <p>Free tempo preview for one transition. {status?.ai ? 'AI uses the app owner’s budget.' : 'Paid AI generation is disabled pending review.'}</p>
    <p>AI advice describes the last verified pair. The $0.10 lifetime app budget never resets. Exhausting it disables generation until a budget change is approved.</p>
    {pair.length === 2 ? <><p>{pair[0].data.title} → {pair[1].data.title}</p>
      <button disabled={busy} onClick={() => suggest()}>{busy ? 'Checking transition…' : 'Suggest transitions'}</button>
      <button disabled={busy || !status?.ai} onClick={() => suggest(true)}>Generate paid AI recommendation</button>
    </> : <p>Add two tracks to preview a transition.</p>}
    <p role="status">{feedback}</p>
  </section>
}
