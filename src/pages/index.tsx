import { Link } from 'react-router-dom'
import { ArrowUpRight, Disc3 } from 'lucide-react'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

export default function Landing() {
  return (
    <main data-testid="static-landing" className="landing">
      <Seo {...seo} path="/" />
      <header>
        <span className="wordmark">
          <Disc3 aria-hidden /> CueRoom
        </span>
        <Link to="/home">Workspace ↗</Link>
      </header>
      <div className="hero">
        <section>
          <h1>
            Build the set.
            <br />
            <em>Find the flow.</em>
          </h1>
          <p>
            A shared setlist workspace for DJs. Bring your tracks together, compare tempos and keys,
            and shape the night with your crew.
          </p>
          <Link className="cta" to="/home">
            Open workspace <ArrowUpRight size={18} />
          </Link>
        </section>
        <figure className="deck">
          <figcaption>
            Setlist preview <span>03 tracks</span>
          </figcaption>
          <h2>After hours</h2>
          <div className="wave" aria-hidden>
            {Array.from({ length: 72 }, (_, i) => (
              <i
                key={i}
                style={{ height: 15 + Math.abs(Math.sin(i * 2.1) * Math.cos(i / 9)) * 80 + '%' }}
              />
            ))}
          </div>
          {[
            ['Soft Focus', 'Mira Lane', '118', '8A'],
            ['Night Transit', 'Lo Signal', '122', '9A'],
            ['First Light', 'Index Duo', '124', '9B'],
          ].map(([title, artist, bpm, key], i) => (
            <div className="preview-row" key={title}>
              <small>0{i + 1}</small>
              <div>
                <strong>{title}</strong>
                <small>{artist}</small>
              </div>
              <small>{bpm} BPM</small>
              <code>{key}</code>
            </div>
          ))}
        </figure>
      </div>
    </main>
  )
}
