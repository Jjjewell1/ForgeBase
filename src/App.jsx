import { useEffect, useRef, useState } from 'react'

function Login({ onAuthed }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (r.ok) onAuthed()
      else setError((await r.json()).error || 'Login failed')
    } catch { setError('Cannot reach server') } finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <form className="glass login-card" onSubmit={submit}>
        <div style={{ fontSize: 42 }}>🔥</div>
        <h1>Forge<span className="accent-text">Base</span></h1>
        <p>opencode + Ollama, deployed to your homelab</p>
        <input type="password" placeholder="Access password" value={password}
          onChange={e => setPassword(e.target.value)} autoFocus />
        {error && <div className="error-msg">{error}</div>}
        <button className="btn" style={{ width: '100%', marginTop: 18 }} disabled={busy || !password}>
          {busy ? 'Checking…' : 'Enter the forge'}
        </button>
      </form>
    </div>
  )
}

const STATUS_COLOR = {
  queued: '#e0b341', running: '#00d3b8', done: '#5dd97c', error: '#ff5c7c'
}

function StatusChip({ status }) {
  return (
    <span className="chip" style={{ borderColor: STATUS_COLOR[status] || '#888', color: STATUS_COLOR[status] || '#888' }}>
      {status}
    </span>
  )
}

function StatsRow({ build }) {
  const s = build.stats
  if (!s || !s.steps) return null
  const dur = build.finishedAt && build.startedAt
    ? Math.round((build.finishedAt - build.startedAt) / 1000)
    : Math.round((Date.now() - build.startedAt) / 1000)
  const items = [
    ['⏱', `${dur}s`],
    ['▲', `${s.inputTokens} in`],
    ['▼', `${s.outputTokens} out`],
    ['◎', `ctx ${s.totalTokens}/32k`],
    ['✦', `${s.steps} step${s.steps === 1 ? '' : 's'}`],
    ['$', s.cost > 0 ? `$${s.cost.toFixed(4)}` : 'local']
  ]
  return (
    <div className="stats-row">
      {items.map(([ic, label]) => (
        <span key={label} className="stat-chip"><span className="stat-ic">{ic}</span>{label}</span>
      ))}
    </div>
  )
}

function BuildView({ buildId }) {
  const [build, setBuild] = useState(null)
  const [files, setFiles] = useState([])
  const [preview, setPreview] = useState(null)
  const logRef = useRef(null)

  useEffect(() => {
    let stop = false
    async function poll() {
      while (!stop) {
        try {
          const b = await (await fetch(`/api/builds/${buildId}`)).json()
          if (stop) return
          setBuild(b)
          if (b.status === 'done' || b.status === 'error') break
        } catch { /* keep polling */ }
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    poll()
    return () => { stop = true }
  }, [buildId])

  useEffect(() => {
    if ((build?.status === 'done' || build?.status === 'error') && files.length === 0) {
      fetch(`/api/builds/${buildId}/files`).then(r => r.json()).then(setFiles).catch(() => {})
    }
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [build])

  async function openFile(p) {
    const text = await (await fetch(`/api/builds/${buildId}/file?path=${encodeURIComponent(p)}`)).text()
    setPreview({ path: p, text })
  }

  if (!build) return <div className="glass empty-state">Loading build…</div>

  return (
    <>
      <div className="glass builder-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <StatusChip status={build.status} />
          <span className="mono-dim">build {build.id} · {build.model}</span>
        </div>
        <StatsRow build={build} />
        <pre className="prompt-quote">{build.prompt}</pre>
        <pre className="log-pane" ref={logRef}>
          {(build.logs || []).map((l, i) => <div key={i}>{l.line}</div>)}
          {!build.logs?.length && build.status === 'queued' && 'queued — waiting for a free runner…'}
        </pre>
        {build.error && <div className="error-msg">{build.error}</div>}
      </div>

      {files.length > 0 && (
        <>
          <div className="section-title">Generated files ({files.length})</div>
          <div className="two-col">
            <div className="glass file-list">
              {files.map(f => (
                <button key={f.path} className={'file-item' + (preview?.path === f.path ? ' active' : '')}
                  onClick={() => openFile(f.path)}>
                  {f.path} <span className="mono-dim">{f.size > 1024 ? `${(f.size / 1024).toFixed(1)}k` : `${f.size}b`}</span>
                </button>
              ))}
            </div>
            <pre className="glass file-preview">{preview ? preview.text : '← select a file to preview'}</pre>
          </div>
        </>
      )}
    </>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(null)
  const [models, setModels] = useState([])
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [activeBuild, setActiveBuild] = useState(null)
  const [history, setHistory] = useState([])

  async function refreshHistory() {
    try { setHistory(await (await fetch('/api/builds')).json()) } catch {}
  }

  useEffect(() => {
    fetch('/api/auth/check').then(r => {
      if (r.ok) {
        setAuthed(true)
        fetch('/api/models').then(x => x.json()).then(m => {
          setModels(m.models); setModel(m.default || m.models[0] || '')
        }).catch(() => {})
        refreshHistory()
      } else setAuthed(false)
    }).catch(() => setAuthed(false))
  }, [])

  if (authed === null) return <div className="loading">Connecting…</div>
  if (!authed) return <Login onAuthed={() => {
    setAuthed(true)
    fetch('/api/models').then(x => x.json()).then(m => { setModels(m.models); setModel(m.default || m.models[0] || '') }).catch(() => {})
  }} />

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }); setAuthed(false)
  }

  async function startBuild(e) {
    e.preventDefault()
    setStarting(true); setStartError('')
    try {
      const r = await fetch('/api/builds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to start')
      setActiveBuild(j.id); setPrompt(''); refreshHistory()
    } catch (err) { setStartError(err.message) } finally { setStarting(false) }
  }

  return (
    <>
      <nav className="glass nav">
        <div className="brand"><span className="flame">🔥</span>Forge<span className="accent-text">Base</span></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="mono-dim">{model}</span>
          <a className="btn ghost" href="https://launchbase.jewellcore.com" target="_blank" rel="noreferrer">LaunchBase ↗</a>
          <button className="btn ghost" onClick={logout}>Log out</button>
        </div>
      </nav>

      <div className="glass builder-card">
        <h2>What should we build?</h2>
        <p className="builder-sub">
          opencode runs headlessly against <code>{model || 'Ollama'}</code> on Unraid.
          Generated projects land in a workspace you can browse below.
        </p>
        <div className="builder-row">
          <textarea
            placeholder="e.g. Create a single-page snake game with arrow-key controls and a score counter…"
            value={prompt} onChange={e => setPrompt(e.target.value)} disabled={starting}
          />
          <div className="builder-side">
            <select value={model} onChange={e => setModel(e.target.value)} title="Model (from Ollama on Unraid)">
              {models.length === 0 && <option value="">ollama</option>}
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="btn" style={{ flex: 1 }} disabled={starting || prompt.trim().length < 10} onClick={startBuild}>
              {starting ? 'Starting…' : 'Build it'}
            </button>
          </div>
        </div>
        {startError && <div className="error-msg">{startError}</div>}
      </div>

      {activeBuild && <><div className="section-title">Current build</div><BuildView key={activeBuild} buildId={activeBuild} /></>}

      {history.length > 0 && (
        <>
          <div className="section-title">Build history</div>
          <div className="glass file-list">
            {history.map(b => (
              <button key={b.id} className={'file-item' + (activeBuild === b.id ? ' active' : '')} onClick={() => setActiveBuild(b.id)}>
                <StatusChip status={b.status} /> {b.prompt.slice(0, 70)}
                <span className="mono-dim">{new Date(b.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <footer className="footer">
        ForgeBase · part of the jewellcore homelab · apps appear in <a href="https://launchbase.jewellcore.com">LaunchBase</a> automatically
      </footer>
    </>
  )
}
