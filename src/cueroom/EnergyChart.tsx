import type { Track } from './data'
import { energyLevel } from './insights'

export function EnergyChart({ tracks }: { tracks: Track[] }) {
  const levels = tracks.map(track => energyLevel(track.energy))
  const points = levels.map((level, i) => level === null ? null : ({
    x: levels.length === 1 ? 150 : 5 + 290 * i / (levels.length - 1),
    y: 141 - (level - 1) * 32,
  }))
  const missing = levels.filter(level => level === null).length
  const label = (value: number | null | undefined) => value == null ? 'Unavailable' : value + '/5'
  return <section className="energy-section">
    <h3>Energy progression</h3>
    {tracks.length > 0 && <span className="energy-range">{levels[0] ?? '—'} → {levels.at(-1) ?? '—'}</span>}
    {missing < tracks.length ? <>
      <svg viewBox="0 0 300 154" role="img" aria-label={'Energy progression in running order: ' + levels.map(label).join(', ')}>
        {[13, 45, 77, 109, 141].map(y => <path key={y} d={'M5 ' + y + ' H295'} className="chart-guide" />)}
        {points.map((point, i) => {
          if (!point) return null
          const previous = points[i - 1]
          return <g key={i}>
            {previous && <line x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} />}
            <circle cx={point.x} cy={point.y} r={Math.min(4, Math.max(1, 90 / tracks.length))}>
              <title>{`${tracks[i].title} · ${label(levels[i])}`}</title>
            </circle>
          </g>
        })}
      </svg>
      <div className="chart-ends"><span>Start · {label(levels[0])}</span><span>Finish · {label(levels.at(-1))}</span></div>
      {missing > 0 && <p>{missing} of {tracks.length} energy values unavailable.</p>}
    </> : <p>{tracks.length ? 'Energy unavailable for every track.' : 'Add a track to see its energy.'}</p>}
  </section>
}
