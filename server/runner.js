import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const WORKSPACES = '/data/workspaces'
const MAX_LOG_LINES = 6000
const TIMEOUT_MS = 20 * 60 * 1000
const MAX_RUNNING = 1
const MAX_WAITING = 5

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://192.168.1.154:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b'

const builds = new Map()
let chain = Promise.resolve()

function id() {
  return crypto.randomBytes(6).toString('hex')
}

function writeOpencodeConfig(ws, model) {
  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      ollama: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Ollama (Unraid)',
        options: { baseURL: `${OLLAMA_BASE_URL}/v1`, apiKey: 'ollama' },
        models: { [model]: { tool_call: true, reasoning: false } }
      }
    },
    permission: { edit: 'allow' }
  }
  fs.writeFileSync(path.join(ws, 'opencode.json'), JSON.stringify(config, null, 2))
  fs.writeFileSync(
    path.join(ws, 'AGENTS.md'),
    `# Project rules\n\n- Create ALL files inside the current working directory (relative paths only).\n- NEVER write to /path/to, /tmp, or any absolute path outside this directory.\n- This is a brand-new empty project: create every file you mention.\n`
  )
}

export function getModel() {
  return OLLAMA_MODEL
}

export async function listOllamaModels() {
  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(4000) })
    const j = await r.json()
    return (j.models || []).map(m => m.name)
  } catch {
    return []
  }
}

export function getBuild(buildId) {
  return builds.get(buildId) || null
}

const publicBuild = ({ logs, ...b }) => ({ ...b })

export function listBuilds() {
  return [...builds.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ logs, ...b }) => ({ ...b, logLines: logs.length }))
}

export function createBuild(prompt, requestedModel) {
  const waiting = [...builds.values()].filter(b => b.status === 'queued').length
  if (waiting >= MAX_WAITING) return { error: 'Too many queued builds — try again shortly' }

  const model = /^[A-Za-z0-9._:-]{1,120}$/.test(String(requestedModel || '')) ? requestedModel : OLLAMA_MODEL
  const buildId = id()
  const ws = path.join(WORKSPACES, buildId)
  fs.mkdirSync(ws, { recursive: true })
  writeOpencodeConfig(ws, model)

  // Small models love hallucinating "/path/to/x". Make that harmless: point
  // /path/to at the ACTIVE workspace (runner is single-concurrency).
  try {
    fs.mkdirSync('/path', { recursive: true })
    try { fs.unlinkSync('/path/to') } catch {}
    fs.symlinkSync(ws, '/path/to')
  } catch { /* best effort */ }

  const build = {
    id: buildId,
    prompt: String(prompt).slice(0, 8000),
    model,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    error: null,
    stats: null,
    logs: []
  }
  builds.set(buildId, build)
  runWhenFree(build, ws)
  return { build: publicBuild(build) }
}

function runWhenFree(build, ws) {
  chain = chain.then(() => runBuild(build, ws)).catch(e => {
    console.error('runner chain error:', e.message)
  })
}

function log(build, line) {
  if (build.logs.length < MAX_LOG_LINES) build.logs.push({ t: Date.now(), line: String(line).slice(0, 500) })
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const clean = s => String(s).replace(ANSI, '').replace(/\r/g, '').trimEnd()

async function runBuild(build, ws) {
  build.status = 'running'
  build.startedAt = Date.now()
  log(build, `$ opencode run -m ollama/${build.model}`)

  // opencode misbehaves when its stdio are pipes/devnull (instant "server error").
  // The proven-working invocation is bash with FILE redirects. --format json gives
  // us the TUI's right-side data (tokens/cost per step) as JSONL on stdout;
  // --auto stops a single denied permission from killing the whole session.
  const shQuote = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`
  const fullPrompt = build.prompt + '\n\n(IMPORTANT: create all files with RELATIVE paths in the current directory — never /path/to/ or /tmp.)'
  const cmd = `opencode run --format json --auto -m ollama/${shQuote(build.model)} ${shQuote(fullPrompt)} > o.txt 2> e.txt`

  const stats = { steps: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
  const offsets = { 'o.txt': 0, 'e.txt': 0 }

  function drain() {
    for (const [file, kind] of [['o.txt', 'out'], ['e.txt', 'err']]) {
      try {
        const abs = path.join(ws, file)
        const buf = fs.readFileSync(abs)
        if (buf.length <= offsets[file]) continue
        const chunk = buf.slice(offsets[file]).toString('utf8')
        offsets[file] = buf.length
        for (const raw of chunk.split(/\r?\n/)) {
          const line = clean(raw)
          if (!line) continue
          if (kind === 'out' && line.startsWith('{')) {
            let evt = null
            try { evt = JSON.parse(line) } catch {}
            if (evt?.type === 'step_finish' && evt.part?.tokens) {
              const t = evt.part.tokens
              stats.steps++
              stats.inputTokens += t.input || 0
              stats.outputTokens += t.output || 0
              stats.totalTokens = t.total || stats.totalTokens
              stats.cost += evt.part.cost || 0
              build.stats = { ...stats }
              log(build, `◆ step ${stats.steps}: ↑${t.input} ↓${t.output} tokens · ctx ${t.total}/32k`)
            } else if (evt?.type === 'error') {
              log(build, `[event] error: ${evt.error?.data?.message || evt.error?.name || 'unknown'}`)
            } else if (evt?.type && evt.type !== 'step_start') {
              log(build, `[event] ${evt.type}`)
            }
          } else if (kind === 'err' && !line.startsWith('> build')) {
            log(build, line.slice(0, 400))
          }
        }
      } catch { /* file not created yet */ }
    }
  }

  const tailer = setInterval(drain, 1500)

  await new Promise(resolve => {
    let settled = false
    const finish = (status, extra = {}) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(tailer)
      drain()
      build.stats = { ...stats }
      build.status = status
      build.finishedAt = Date.now()
      Object.assign(build, extra)
      resolve()
    }

    const child = spawn('bash', ['-c', `cd ${shQuote(ws)} && ${cmd}`], {
      cwd: ws,
      stdio: 'ignore',
      env: { ...process.env, HOME: '/root', OPENCODE_DISABLE_AUTOUPDATE: 'true' }
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish('error', { error: 'Timed out after 20 minutes' })
    }, TIMEOUT_MS)

    child.on('error', e => finish('error', { error: e.message }))
    child.on('close', code => {
      if (code === 0) finish('done', { exitCode: 0 })
      else finish('error', { exitCode: code, error: `opencode exited with code ${code}` })
    })
  })
}

// ---- workspace file access ------------------------------------------------

const SKIP = new Set(['node_modules', '.git', '.opencode', 'dist'])

export function listFiles(buildId) {
  const ws = safeWs(buildId)
  if (!ws) return null
  const out = []
  const walk = (dir, rel) => {
    if (out.length > 2000) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      const r = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, r)
      else out.push({ path: r, size: entry.isFile() ? fs.statSync(abs).size : 0 })
    }
  }
  walk(ws, '')
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function readFile(buildId, relPath) {
  const ws = safeWs(buildId)
  if (!ws) return null
  const abs = path.resolve(ws, relPath)
  if (!abs.startsWith(path.resolve(ws))) return null
  try {
    const st = fs.statSync(abs)
    if (!st.isFile() || st.size > 200_000) return null
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

function safeWs(buildId) {
  if (!/^[a-f0-9]{12}$/.test(buildId)) return null
  const ws = path.join(WORKSPACES, buildId)
  return fs.existsSync(ws) ? ws : null
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
console.log(`runner ready — model ${OLLAMA_MODEL} @ ${OLLAMA_BASE_URL}, workspaces in ${WORKSPACES}`)
