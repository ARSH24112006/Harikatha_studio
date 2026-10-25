
import { useEffect, useState } from 'react'
import { AudioLines, BookOpen, CheckCircle2, ChevronDown, CircleAlert, Feather, Headphones, LoaderCircle, Music2, Sparkles } from 'lucide-react'

const API = 'http://localhost:8000/api/v1'

type Section = {
  type: string
  title: string
  content: string
  sources?: {
    id: string
    title: string
    citation: string
    status: string
  }[]
  song_metadata?: {
    kind?: string
    raga?: string | null
    tala?: string | null
  } | null
}

type RecordResult = {
  id: string
  performance: {
    title: string
    language: string
    sections: Section[]
    content_notes?: string[]
  }
}

export default function App() {
  const [story, setStory] = useState(
    'Tell the story of a person who learns the value of honesty after making a difficult choice. Make it suitable for a respectful, family-friendly storytelling performance.'
  )
  const [title, setTitle] = useState('The Path of Truth')
  const [language, setLanguage] = useState('English')
  const [duration, setDuration] = useState(8)
  const [tone, setTone] = useState('devotional and engaging')
  const [audience, setAudience] = useState('general audience')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // FIX: Match the field returned by your backend health endpoint.
  const [health, setHealth] = useState<{
    status: string
    ollama_reachable: boolean
    model: string
    piper_configured: boolean
  } | null>(null)

  const [result, setResult] = useState<RecordResult | null>(null)
  const [audio, setAudio] = useState<Record<number, string>>({})
  const [audioBusy, setAudioBusy] = useState<number | null>(null)
  const [fullAudio, setFullAudio] = useState<string | null>(null)
  const [fullAudioBusy, setFullAudioBusy] = useState(false)
  const [expanded, setExpanded] = useState<number[]>([0])

  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => {
        if (!r.ok) throw new Error('Health check failed')
        return r.json()
      })
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  async function generate() {
    setBusy(true)
    setError('')
    setResult(null)
    setAudio({})
    setFullAudio(null)

    try {
      const res = await fetch(`${API}/harikatha/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story,
          title,
          language,
          duration_minutes: duration,
          tone,
          audience
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Generation failed')
      }

      setResult(data)
      setExpanded([0])
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Something went wrong. Check that the backend and Ollama are running.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function makeAudio(index: number) {
    if (!result) return

    setAudioBusy(index)
    setError('')

    try {
      const res = await fetch(
        `${API}/harikatha/${result.id}/audio/${index}`,
        { method: 'POST' }
      )

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Audio generation failed')
      }

      setAudio(prev => ({
        ...prev,
        [index]: `http://localhost:8000${data.audio_url}`
      }))
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Audio generation failed'
      )
    } finally {
      setAudioBusy(null)
    }
  }

  async function makeFullAudio() {
    if (!result) return

    setFullAudioBusy(true)
    setError('')

    try {
      const res = await fetch(
        `${API}/harikatha/${result.id}/narration`,
        { method: 'POST' }
      )

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Full narration failed')
      }

      setFullAudio(`http://localhost:8000${data.audio_url}`)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Full narration generation failed'
      )
    } finally {
      setFullAudioBusy(false)
    }
  }

  const label: Record<string, string> = {
    invocation: 'Invocation',
    introduction: 'Opening',
    narration: 'Story',
    verse: 'Traditional verse',
    song: 'Song / lyrical interlude',
    reflection: 'Reflection',
    moral: 'Moral',
    closing: 'Closing'
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark"><BookOpen size={21} /></span>
          <span>Harikatha<span className="brand-light"> AI</span></span>
        </a>
        <div className="top-meta">
          <span className="local-dot" /> Local-first prototype
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-glow" />
        <div className="eyebrow">
          <Sparkles size={15} /> STORIES THAT SPEAK TO THE HEART
        </div>
        <h1>Turn a story into a<br /><em>living tradition.</em></h1>
        <p className="hero-copy">
          Shape a story into a Harikatha-inspired performance, with narration,
          lyrical moments, reflection and a meaningful close.
        </p>
        <div className="hero-tags">
          <span><Feather size={14} /> Structured storytelling</span>
          <span><Music2 size={14} /> Lyrical interludes</span>
          <span><Headphones size={14} /> Spoken audio</span>
        </div>
      </section>

      <div className="workspace">
        <section className="input-card">
          <div className="section-heading">
            <div>
              <span className="step-label">01 / CREATE</span>
              <h2>Your story begins here</h2>
              <p>Give the storyteller the seed. The local model will shape the performance.</p>
            </div>
            <div className="heading-icon"><Feather size={22} /></div>
          </div>

          <label>
            Story title
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Give your story a title"
            />
          </label>

          <label>
            Your story
            <textarea
              value={story}
              onChange={e => setStory(e.target.value)}
              rows={6}
              placeholder="Paste or describe the story you want to tell…"
            />
          </label>

          <div className="field-grid">
            <label>
              Output language
              <select value={language} onChange={e => setLanguage(e.target.value)}>
                <option>English</option>
                <option>Hindi</option>
                <option>Telugu</option>
                <option>Tamil</option>
                <option>Kannada</option>
                <option>Sanskrit</option>
              </select>
            </label>

            <label>
              Performance length
              <select
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
              >
                <option value={3}>3 minutes</option>
                <option value={5}>5 minutes</option>
                <option value={8}>8 minutes</option>
                <option value={12}>12 minutes</option>
                <option value={20}>20 minutes</option>
              </select>
            </label>

            <label>
              Tone
              <select value={tone} onChange={e => setTone(e.target.value)}>
                <option>devotional and engaging</option>
                <option>philosophical</option>
                <option>educational</option>
                <option>family-friendly</option>
              </select>
            </label>

            <label>
              Audience
              <select value={audience} onChange={e => setAudience(e.target.value)}>
                <option>general audience</option>
                <option>children</option>
                <option>experienced listeners</option>
              </select>
            </label>
          </div>

          <button
            className="primary-button"
            onClick={generate}
            disabled={busy || story.trim().length < 20}
          >
            {busy ? (
              <>
                <LoaderCircle className="spin" size={18} />
                Creating your Harikatha…
              </>
            ) : (
              <>
                <Sparkles size={18} />
                Generate Harikatha <span>→</span>
              </>
            )}
          </button>

          <div className="privacy-note">
            <CheckCircle2 size={15} />
            Story generation runs through your local Ollama model; no hosted LLM key is needed.
          </div>

          {/* FIX: Use ollama_reachable, matching /api/v1/health. */}
          {health && (
            <div
              className={`connection ${
                health.ollama_reachable ? 'online' : 'offline'
              }`}
            >
              <span className="status-dot" />
              {health.ollama_reachable
                ? `Ollama connected · ${health.model}`
                : 'Ollama not detected · start Ollama before generating'}

              <span className="connection-audio">
                {health.piper_configured
                  ? 'Piper configured'
                  : 'Audio setup pending'}
              </span>
            </div>
          )}
        </section>

        <section className="result-area">
          <div className="result-top">
            <div>
              <span className="step-label">02 / EXPERIENCE</span>
              <h2>Your performance</h2>
            </div>
            {result && (
              <span className="ready-pill">
                <CheckCircle2 size={14} /> Generated
              </span>
            )}
          </div>

          {error && (
            <div className="error-box">
              <CircleAlert size={18} />
              <div>
                <strong>Something needs attention</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          {!result && !busy && (
            <div className="empty-state">
              <div className="empty-art">
                <BookOpen size={38} />
                <span className="spark spark-one">✦</span>
                <span className="spark spark-two">✧</span>
              </div>
              <h3>Your story, retold with purpose.</h3>
              <p>
                Generate a performance to see its narrative sections, lyrical
                interludes, reflections and available audio controls here.
              </p>
              <div className="empty-rule" />
              <div className="empty-feature">
                <span>01</span>
                <div>
                  <strong>A thoughtful structure</strong>
                  <small>Opening, story, reflection and close</small>
                </div>
              </div>
              <div className="empty-feature">
                <span>02</span>
                <div>
                  <strong>Honest source handling</strong>
                  <small>No invented citations presented as verified</small>
                </div>
              </div>
              <div className="empty-feature">
                <span>03</span>
                <div>
                  <strong>Local spoken narration</strong>
                  <small>Enable Piper to create audio</small>
                </div>
              </div>
            </div>
          )}

          {busy && (
            <div className="loading-state">
              <div className="loader-orbit"><Sparkles size={26} /></div>
              <h3>Weaving your story…</h3>
              <p>
                Your local model is building a structured performance. This
                can take a little while on a laptop.
              </p>
              <div className="loading-bar"><span /></div>
            </div>
          )}

          {result && (
            <div className="performance">
              <div className="performance-title">
                <span className="performance-kicker">
                  A HARIKATHA-INSPIRED PERFORMANCE
                </span>
                <h3>{result.performance.title || title}</h3>
                <p>
                  {result.performance.language || language} ·{' '}
                  {result.performance.sections.length} sections
                </p>
              </div>

              <div className="audio-tools">
                {fullAudio ? (
                  <>
                    <audio controls preload="metadata" src={fullAudio} />
                    <a
                      className="secondary-button"
                      href={fullAudio}
                      download={`${result.performance.title || 'harikatha'}-full.wav`}
                    >
                      Download full narration
                    </a>
                  </>
                ) : (
                  <button
                    className="audio-button"
                    onClick={makeFullAudio}
                    disabled={fullAudioBusy}
                  >
                    {fullAudioBusy
                      ? 'Generating full narration…'
                      : 'Generate Full Narration'}
                  </button>
                )}
              </div>

              <div className="section-list">
                {result.performance.sections.map((section, index) => (
                  <article
                    className="story-section"
                    key={`${index}-${section.title}`}
                  >
                    <button
                      className="section-toggle"
                      onClick={() =>
                        setExpanded(prev =>
                          prev.includes(index)
                            ? prev.filter(i => i !== index)
                            : [...prev, index]
                        )
                      }
                    >
                      <span className={`section-number type-${section.type}`}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="section-name">
                        <small>{label[section.type] || section.type}</small>
                        <strong>{section.title}</strong>
                      </span>
                      <ChevronDown
                        size={18}
                        className={expanded.includes(index) ? 'chevron open' : 'chevron'}
                      />
                    </button>

                    {expanded.includes(index) && (
                      <div className="section-body">
                        <p>{section.content}</p>

                        {section.song_metadata && (
                          <div className="song-meta">
                            <Music2 size={15} />
                            <span>
                              {section.song_metadata.kind || 'Song'}
                              {section.song_metadata.raga
                                ? ` · Raga: ${section.song_metadata.raga}`
                                : ''}
                              {section.song_metadata.tala
                                ? ` · Tala: ${section.song_metadata.tala}`
                                : ''}
                            </span>
                          </div>
                        )}

                        {section.sources?.map(src => (
                          <div className="source-note" key={src.id}>
                            <BookOpen size={14} />
                            <span>
                              <strong>{src.title}</strong>
                              <small>{src.citation} · {src.status}</small>
                            </span>
                          </div>
                        ))}

                        <div className="audio-tools">
                          {audio[index] ? (
                            <audio controls preload="none" src={audio[index]} />
                          ) : (
                            <button
                              className="audio-button"
                              onClick={() => makeAudio(index)}
                              disabled={audioBusy === index}
                            >
                              {audioBusy === index ? (
                                <LoaderCircle size={15} className="spin" />
                              ) : (
                                <AudioLines size={15} />
                              )}
                              Generate spoken audio
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>

              {result.performance.content_notes?.length ? (
                <div className="notes-box">
                  <strong>Content notes</strong>
                  {result.performance.content_notes.map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
                </div>
              ) : null}

              <div className="result-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    const blob = new Blob(
                      [JSON.stringify(result.performance, null, 2)],
                      { type: 'application/json' }
                    )
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'harikatha-performance.json'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Download performance JSON
                </button>

                <button
                  className="secondary-button"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      result.performance.sections
                        .map(s => `${s.title}\n\n${s.content}`)
                        .join('\n\n---\n\n')
                    )
                  }
                >
                  Copy full text
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <footer>
        <div className="footer-brand">
          <BookOpen size={17} /> Harikatha AI
        </div>
        <p>
          A local-first prototype. Traditional quotations require source
          verification and human review.
        </p>
        <span>Built for stories, meaning & listening.</span>
      </footer>
    </main>
  )
}
