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

function writeOpencodeConfig(ws) {
  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      ollama: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Ollama (Unraid)',
        options: { baseURL: `${OLLAMA_BASE_URL}/v1`, apiKey: 'ollama' },
        models: { [OLLAMA_MODEL]: { tool_call: true, reasoning: false } }
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

export function getBuild(buildId) {
  return builds.get(buildId) || null
}

const publicBuild = ({ logs, ...b }) => ({ ...b })

export function listBuilds() {
  return [...builds.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ logs, ...b }) => ({ ...b, logLines: logs.length }))
}

export function createBuild(prompt) {
  const waiting = [...builds.values()].filter(b => b.status === 'queued').length
  const running = [...builds.values()].filter(b => b.status === 'running').length
  if (waiting >= MAX_WAITING) return { error: 'Too many queued builds — try again shortly' }

  const buildId = id()
  const ws = path.join(WORKSPACES, buildId)
  fs.mkdirSync(ws, { recursive: true })
  writeOpencodeConfig(ws)

  const build = {
    id: buildId,
    prompt: String(prompt).slice(0, 8000),
    model: OLLAMA_MODEL,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    error: null,
    logs: []
  }
  builds.set(buildId, build)
  runWhenFree(build, ws)
  return { build: publicBuild(build) }

  // Small models love hallucinating "/path/to/x". Make that harmless: point
  // /path/to at the ACTIVE workspace (runner is single-concurrency).
  try {
    fs.mkdirSync('/path', { recursive: true })
    try { fs.unlinkSync('/path/to') } catch {}
    fs.symlinkSync(ws, '/path/to')
  } catch { /* best effort */ }
}

function runWhenFree(build, ws) {
  chain = chain.then(() => runBuild(build, ws)).catch(e => {
    console.error('runner chain error:', e.message)
  })
}

function log(build, line) {
  if (build.logs.length < MAX_LOG_LINES) build.logs.push({ t: Date.now(), line: String(line).slice(0, 500) })
}

async function runBuild(build, ws) {
  build.status = 'running'
  build.startedAt = Date.now()
  log(build, `$ opencode run -m ollama/${build.model}`)

  // opencode misbehaves when its stdio are pipes/devnull (instant "server error").
  // The proven-working invocation is bash with FILE redirects — so we quote the
  // prompt into the command line and capture o.txt/e.txt afterwards.
  const shQuote = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`
  const fullPrompt = build.prompt + '\n\n(IMPORTANT: create all files with RELATIVE paths in the current directory — never /path/to/.)'
  const cmd = `opencode run -m ollama/${shQuote(build.model)} ${shQuote(fullPrompt)} > o.txt 2> e.txt`

  await new Promise(resolve => {
    let settled = false
    const finish = (status, extra = {}) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      build.status = status
      build.finishedAt = Date.now()
      Object.assign(build, extra)
      // harvest captured output
      try {
        const out = fs.readFileSync(path.join(ws, 'e.txt'), 'utf8')
        const so = fs.readFileSync(path.join(ws, 'o.txt'), 'utf8')
        for (const line of out.split(/\r?\n/)) if (line.trim()) log(build, `[stderr] ${line.slice(0, 400)}`)
        for (const line of so.split(/\r?\n/)) if (line.trim()) log(build, line.slice(0, 400))
      } catch { /* files may be missing on early crash */ }
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
