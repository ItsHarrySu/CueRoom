import { Link } from 'react-router-dom'
import { ArrowUpRight, Disc3, Layers3, Link2, ListOrdered } from 'lucide-react'
import { Brand } from '../components/Brand'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const preview = [
  ['Soft Focus', 'Mira Lane', '118', '8A'],
  ['Night Transit', 'Lo Signal', '122', '9A'],
  ['First Light', 'Index Duo', '124', '9B'],
]

export default function Landing() {
  return (
    <main data-testid="static-landing" className="landing">
      <Seo {...seo} path="/" />
      <header>
        <Brand />
        <Link className="utility-link" to="/home">
          Workspace <ArrowUpRight size={16} />
        </Link>
      </header>
      <div className="hero">
        <section>
          <p className="caption">Collaborative setlist planner</p>
          <h1>
            Before the
            <br />
            <em>first cue.</em>
          </h1>
          <p className="intro">
            Build the running order with your crew. Line up tempos, compare keys and shape the
            energy of your next set.
          </p>
          <Link className="cta" to="/home">
            Open workspace <ArrowUpRight size={18} />
          </Link>
        </section>
        <figure className="deck">
          <figcaption className="caption">
            <span>Setlist preview</span>
            <span>03 tracks</span>
          </figcaption>
          <div className="sleeve">
            <Disc3 aria-hidden />
            <h2>After hours</h2>
          </div>
          <ol>
            {preview.map(([title, artist, bpm, key], i) => (
              <li className="preview-row" key={title}>
                <span className="meta">0{i + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <small>{artist}</small>
                </div>
                <span className="meta">{bpm} BPM</span>
                <code aria-label={'Key ' + key}>{key}</code>
              </li>
            ))}
          </ol>
        </figure>
      </div>
      <section className="workflow" aria-label="How collaboration works">
        <article>
          <Layers3 />
          <h2>Create a room</h2>
          <p>Give each gig its own shared setlist.</p>
        </article>
        <article>
          <Link2 />
          <h2>Invite your crew</h2>
          <p>Copy the room invitation so other DJs can join.</p>
        </article>
        <article>
          <ListOrdered />
          <h2>Shape the order</h2>
          <p>Add tracks and move them into place together.</p>
        </article>
      </section>
    </main>
  )
}
