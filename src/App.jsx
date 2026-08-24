import { useState } from 'react'

export default function App() {
  const [prompt, setPrompt] = useState('')

  return (
    <>
      <nav className="glass nav">
        <div className="brand">
          <span className="flame">🔥</span>
          Forge<span className="accent-text">Base</span>
        </div>
        <a className="btn ghost" href="https://launchbase.jewellcore.com" target="_blank" rel="noreferrer">
          LaunchBase ↗
        </a>
      </nav>

      <div className="glass builder-card">
        <span className="badge">v1 — generation engine lands in Phase 2</span>
        <h2 style={{ marginTop: 12 }}>What should we build?</h2>
        <p className="builder-sub">
          Describe an app or site. It will be generated with opencode and deployed live to{' '}
          <code>&lt;name&gt;.jewellcore.com</code>.
        </p>
        <div className="builder-row">
          <textarea
            placeholder="e.g. A recipe box where I can save recipes by photo and search them later…"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
          <div className="builder-side">
            <select defaultValue="" disabled title="Model picker arrives with Phase 2">
              <option value="">Model…</option>
              <option>opencode Zen</option>
              <option>Gemini</option>
              <option>Ollama</option>
            </select>
            <button className="btn" disabled style={{ flex: 1 }}>
              Build it
            </button>
          </div>
        </div>
      </div>

      <div className="section-title">Built apps</div>
      <div className="glass empty-state">
        Nothing forged yet. The prompt → generate → deploy pipeline ships in Phase 2–3.
      </div>

      <footer className="footer">
        ForgeBase · part of the jewellcore homelab · apps appear in{' '}
        <a href="https://launchbase.jewellcore.com">LaunchBase</a> automatically
      </footer>
    </>
  )
}
