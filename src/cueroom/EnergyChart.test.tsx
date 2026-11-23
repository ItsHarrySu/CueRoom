import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { EnergyChart } from './EnergyChart'

function render(levels: (number | null)[]) {
  return renderToStaticMarkup(<EnergyChart tracks={levels.map((energy, i) =>
    ({ title: 'Track ' + i, artist: '', roomId: '', energy }))} />)
}

it('keeps missing and invalid samples in position and breaks adjacent line segments', () => {
  const html = render([null, 2, 3, 0, 4, 5, null])
  expect(html.match(/<line /g)).toHaveLength(2)
  expect(html.match(/<circle /g)).toHaveLength(4)
  expect(html).toContain('Start · Unavailable')
  expect(html).toContain('Finish · Unavailable')
  expect(html).toContain('Unavailable, 2/5, 3/5, Unavailable, 4/5, 5/5, Unavailable')
  expect(render([1, null, 5])).not.toContain('<line ')
})

it('handles empty sets, absent energy and a single centered point', () => {
  expect(render([])).toContain('Add a track')
  expect(render([null, 6])).toContain('Energy unavailable for every track')
  expect(render([2])).toContain('cx="150"')
  expect(render([2])).not.toContain('<line ')
})

it('renders the full 200-track series without dropping observations', () => {
  const html = render(Array.from({ length: 200 }, (_, i) => i % 5 + 1))
  expect(html.match(/<line /g)).toHaveLength(199)
  expect(html.match(/<circle /g)).toHaveLength(200)
})
