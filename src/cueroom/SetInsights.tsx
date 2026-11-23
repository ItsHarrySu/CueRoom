import type { Track } from './data'
import { EnergyChart } from './EnergyChart'
import { transition } from './insights'

export function SetInsights({ tracks, selected, children }: { tracks: Track[]; selected: number; children?: React.ReactNode }) {
  const pair = transition(tracks, selected)
  const start = Math.min(selected, tracks.length - 2)
  const number = (i: number) => String(i + 1).padStart(2, '0')
  return <aside className="set-insights" id="set-insights" aria-label="Set insights">
    <header><h2>Set intelligence</h2><strong>The shape of your set</strong><p>Derived from your track metadata</p></header>
    <EnergyChart tracks={tracks} />
    <section className="transition-focus" aria-live="polite">
      <h3>Transition focus</h3>
      {pair ? <>
        <div className="pair-index" title={pair.from.title + ' → ' + pair.to.title}>{number(start)} → {number(start + 1)}</div>
        <div className="delta"><b>{pair.delta === null ? 'Unavailable' : (pair.delta > 0 ? '+' : '') + Number(pair.delta.toFixed(2))}</b> BPM</div>
        <div className="key-change">{pair.from.musicalKey || 'Unavailable'} → {pair.to.musicalKey || 'Unavailable'}</div>
        <p>{pair.from.title} → {pair.to.title}</p>
      </> : <p>Add at least two tracks to compare a transition.</p>}
    </section>
    <section><h3>Recorded key sequence</h3>
      {tracks.length ? <ol className="key-flow">{tracks.map((track, i) =>
        <li key={i} title={track.title}>{track.musicalKey || 'Unavailable'}</li>)}</ol> : <p>No tracks yet.</p>}
    </section>
    {children}
    <section className="data-note"><h3>Data note</h3><p>Gaps indicate missing track metadata.</p></section>
  </aside>
}
