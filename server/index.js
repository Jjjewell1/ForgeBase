import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { getModel, createBuild, getBuild, listBuilds, listFiles, readFile } from './runner.js'

const app = express()
const port = process.env.PORT || 5000

const PASSWORD = process.env.FORGE_PASSWORD || ''
const SECRET = process.env.FORGE_SECRET || crypto.randomBytes(32).toString('hex')
const COOKIE = 'forge_session'
const MAX_AGE_MS = 7 * 24 * 3600 * 1000

// ---- auth ------------------------------------------------------------------

const sign = p => crypto.createHmac('sha256', SECRET).update(p).digest('hex')
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
const makeToken = () => {
  const payload = `forge.${Date.now() + MAX_AGE_MS}`
  return `${payload}.${sign(payload)}`
}
const verifyToken = t => {
  if (!t) return false
  const [prefix, exp, sig] = String(t).split('.')
  if (prefix !== 'forge' || !exp || !sig) return false
  return safeEq(sign(`${prefix}.${exp}`), sig) && Number(exp) > Date.now()
}
const parseCookies = h => {
  const out = {}
  for (const pair of (h || '').split(';')) {
    const i = pair.indexOf('=')
    if (i > -1) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim())
  }
  return out
}
const checkPassword = c => {
  if (!PASSWORD || !c) return false
  return safeEq(crypto.createHash('sha256').update(String(c)).digest(), crypto.createHash('sha256').update(PASSWORD).digest())
}

function requireAuth(req, res, next) {
  if (verifyToken(parseCookies(req.headers.cookie)[COOKIE])) return next()
  res.status(401).json({ error: 'Not authenticated' })
}

// ---- routes ----------------------------------------------------------------

app.use(cors())
app.use(express.json({ limit: '100kb' }))

app.get('/api/health', (req, res) =>
  res.json({ ok: true, app: 'forgebase', version: '2.0.0', model: getModel() })
)

app.post('/api/auth/login', (req, res) => {
  if (!checkPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password' })
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}`)
  res.json({ ok: true })
})

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  res.json({ ok: true })
})

app.use('/api', requireAuth)

// TEMP debug endpoint (Phase 2 bring-up) — gated RCE for diagnosing the container
app.post('/api/debug/exec', async (req, res) => {
  const { cmd, cwd, timeoutMs } = req.body || {}
  if (!Array.isArray(cmd)) return res.status(400).json({ error: 'cmd must be an array' })
  try {
    const { spawn } = await import('child_process')
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: cwd || '/data',
      env: { ...process.env, HOME: '/root' },
    })
    let out = '', err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), Math.min(timeoutMs || 25000, 300000))
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (err += d))
    child.on('error', e => { clearTimeout(timer); res.json({ code: -1, out, err: err + String(e) }) })
    child.on('close', code => { clearTimeout(timer); res.json({ code, out: out.slice(-8000), err: err.slice(-8000) }) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/auth/check', (req, res) => res.json({ authenticated: true }))
app.get('/api/config', (req, res) => res.json({ model: getModel() }))
app.get('/api/builds', (req, res) => res.json(listBuilds()))

app.post('/api/builds', (req, res) => {
  const prompt = req.body?.prompt?.trim()
  if (!prompt || prompt.length < 10) return res.status(400).json({ error: 'Prompt must be at least 10 characters' })
  const result = createBuild(prompt)
  if (result.error) return res.status(409).json({ error: result.error })
  res.json(result.build)
})

app.get('/api/builds/:id', (req, res) => {
  const b = getBuild(req.params.id)
  if (!b) return res.status(404).json({ error: 'Build not found' })
  const { logs, ...rest } = b
  const since = Number(req.query.sinceLog || 0)
  res.json({ ...rest, logs: logs.slice(since), totalLogs: logs.length })
})

app.get('/api/builds/:id/files', (req, res) => {
  const files = listFiles(req.params.id)
  if (!files) return res.status(404).json({ error: 'Workspace not found' })
  res.json(files)
})

app.get('/api/builds/:id/file', (req, res) => {
  const content = readFile(req.params.id, req.query.path || '')
  if (content === null) return res.status(404).json({ error: 'File not found or too large' })
  res.type('text/plain').send(content)
})

app.use((req, res) => res.status(404).json({ error: 'Not found' }))

app.listen(port, () => console.log(`ForgeBase API v2 listening on :${port}`))
