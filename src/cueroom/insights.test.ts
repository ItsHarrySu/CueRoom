import { describe, expect, it } from 'vitest'
import type { Track } from './data'
import { energyLevel, summarize, transition } from './insights'

const track = (bpm?: number | null, musicalKey?: string): Track => ({
  title: 'Track', artist: 'Artist', roomId: 'room', bpm, musicalKey,
})

describe('set insights', () => {
  it('distinguishes an empty set and missing metadata', () => {
    expect(summarize([])).toEqual({ count: 0, average: null, range: null })
    expect(summarize([track(null), track(NaN)])).toEqual({ count: 2, average: null, range: null })
  })

  it('counts every track but uses only stored BPMs within the supported range', () => {
    expect(summarize([40, 118.5, 240, 0, 241, null].map(bpm => track(bpm)))).toEqual({
      count: 6, average: (40 + 118.5 + 240) / 3, range: [40, 240],
    })
  })

  it('keeps energy gaps distinct from recorded levels', () => {
    expect([null, 0, 1, 2.5, 5, 6].map(energyLevel)).toEqual([null, null, 1, null, 5, null])
  })

  it('compares adjacent tracks in order, including the incoming pair at the end', () => {
    const tracks = [track(125, '8A'), track(122.5, '9A'), track(null)]
    expect(transition(tracks, 0)).toEqual({ from: tracks[0], to: tracks[1], delta: -2.5 })
    expect(transition(tracks, 1)).toEqual({ from: tracks[1], to: tracks[2], delta: null })
    expect(transition(tracks, 2)).toEqual(transition(tracks, 1))
    expect(transition(tracks.slice(0, 1), 0)).toBeNull()
    expect(transition([], 0)).toBeNull()
  })
})
