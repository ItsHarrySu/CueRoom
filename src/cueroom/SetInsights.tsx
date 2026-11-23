import type { Track } from './data'
import { energyLevel, transition } from './insights'

export function SetInsights({ tracks, selected }: { tracks: Track[]; selected: number }) {
  const pair = transition(tracks, selected)
  return <aside className="set-insights" id="set-insights" aria-label="Set insights">
    <h2>Set insights</h2>
    <section className="panel">
      <h3>Energy progression</h3>
      <p className="meta">Recorded energy · 1–5</p>
      {tracks.length ? <>
        <div className="energy-chart" role="img" aria-label={tracks.map((track, index) =>
          (index + 1) + '. ' + track.title + ': ' + (energyLevel(track.energy) ?? 'unavailable')).join(', ')}>
          {tracks.map((track, index) => {
            const energy = energyLevel(track.energy)
            return <span key={index} title={track.title + ' · ' + (energy ?? 'Unavailable')}
              data-missing={energy === null} style={{ height: energy === null ? 3 : energy * 20 + '%' }} />
          })}
        </div>
        <div className="chart-scale"><span>01</span><span>{tracks.length > 1 && tracks.length}</span></div>
        {tracks.some(track => energyLevel(track.energy) === null) && <small>Gray mark · energy unavailable</small>}
      </> : <p>Add a track to see its energy.</p>}
    </section>
    <section className="panel" aria-live="polite">
      <h3>Transition analysis</h3>
      {pair ? <>
        <p>{pair.from.title} → {pair.to.title}</p>
        <dl><dt>BPM change</dt><dd>{pair.delta === null ? 'Unavailable' : (pair.delta > 0 ? '+' : '') + Number(pair.delta.toFixed(2)) + ' BPM'}</dd>
        <dt>Recorded keys</dt><dd className="recorded-key">{pair.from.musicalKey || 'Unavailable'} → {pair.to.musicalKey || 'Unavailable'}</dd></dl>
      </> : <p>Add at least two tracks to compare a transition.</p>}
    </section>
  </aside>
}
