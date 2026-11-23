import type { Track } from './data'

export function validBpm(value: Track['bpm']): value is number {
  return typeof value === 'number' && value >= 40 && value <= 240
}

export function energyLevel(value: Track['energy']) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null
}

export function summarize(tracks: Track[]) {
  const bpms = tracks.map(track => track.bpm).filter(validBpm)
  return {
    count: tracks.length,
    average: bpms.length ? bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length : null,
    range: bpms.length ? [Math.min(...bpms), Math.max(...bpms)] : null,
  }
}

export function transition(tracks: Track[], selected: number) {
  if (tracks.length < 2 || selected < 0 || selected >= tracks.length) return null
  const start = Math.min(selected, tracks.length - 2)
  const from = tracks[start]
  const to = tracks[start + 1]
  const delta = validBpm(from.bpm) && validBpm(to.bpm) ? to.bpm - from.bpm : null
  return { from, to, delta }
}
