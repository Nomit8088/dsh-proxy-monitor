#!/usr/bin/env node
/**
 * Probe the upstream Codex model listing directly.
 *
 * The plugin's live overlay can only synthesize what this endpoint returns, so
 * when a newly released model does not show up in the picker the question is
 * always "did the account get told about it?". This asks the same endpoint the
 * plugin asks, and prints ONLY the model ids — never the token or account id.
 *
 * By default it sends exactly what `src/codex/live-models.ts` sends (no query
 * string). If that call fails, the overlay silently serves the installed
 * catalog, which is precisely the failure this script exists to make visible.
 *
 * Modes:
 *   node scripts/probe-codex-models.mjs
 *     Exact plugin request. A non-200 here is the bug.
 *   CODEX_CLIENT_VERSION=0.159.0 node scripts/probe-codex-models.mjs
 *     Same request with `client_version` set, to show what a given client sees.
 *   CODEX_SWEEP=1 node scripts/probe-codex-models.mjs
 *     Sweep several client versions and diff the reported catalog.
 *   CODEX_FACTS=1 ... 
 *     Also print per-model `minimal_client_version` / `visibility`.
 *
 * Auth comes from the same store the plugin's credential seam reads.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const authPath = join(home, '.openai-codex-auth.json')
const ENDPOINT = 'https://chatgpt.com/backend-api/codex/models'

let auth
try {
  auth = JSON.parse(readFileSync(authPath, 'utf8'))
} catch (error) {
  console.error(`cannot read ${authPath}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

/**
 * Accept the shapes this store has taken. The current profile writes
 * `{ version, credential: { type, access, refresh, expires, accountId } }`.
 */
function credentialOf(doc) {
  const node = doc?.credential ?? doc?.openaiCodex ?? doc?.['openai-codex'] ?? doc
  const tokens = node?.tokens ?? node
  const accessToken = tokens?.access ?? tokens?.access_token ?? tokens?.accessToken
  const accountId = tokens?.accountId ?? tokens?.account_id
  return { accessToken, accountId }
}

const { accessToken, accountId } = credentialOf(auth)
if (typeof accessToken !== 'string' || accessToken.length === 0) {
  console.error('no access token in the stored credential (signed out?)')
  process.exit(2)
}

/** One listing call. Returns a discriminated result instead of throwing. */
async function list(clientVersion) {
  const url = clientVersion === undefined
    ? ENDPOINT
    : `${ENDPOINT}?client_version=${encodeURIComponent(clientVersion)}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(typeof accountId === 'string' && accountId.length > 0 ? { 'chatgpt-account-id': accountId } : {}),
        accept: 'application/json',
        'cache-control': 'no-store',
        'user-agent': 'dsh-openai-codex',
      },
      signal: AbortSignal.timeout(20_000),
    })
    const text = await response.text()
    if (!response.ok) return { url, status: response.status, error: text.slice(0, 300) }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return { url, status: response.status, error: `non-JSON body: ${text.slice(0, 200)}` }
    }
    const rows = Array.isArray(payload) ? payload
      : Array.isArray(payload?.models) ? payload.models
      : Array.isArray(payload?.data) ? payload.data
      : []
    return { url, status: response.status, rows }
  } catch (error) {
    return { url, status: 0, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

function idOf(row) {
  return String(row?.slug ?? row?.id ?? row?.model ?? row?.name ?? '')
}

function report(result, { facts = false } = {}) {
  console.log(`GET ${result.url}`)
  if (result.rows === undefined) {
    console.log(`  -> FAILED (status ${result.status}): ${result.error}`)
    return
  }
  console.log(`  -> HTTP ${result.status}, ${result.rows.length} entries`)
  for (const row of result.rows) {
    const id = idOf(row)
    const label = row?.display_name ?? row?.name
    const extra = facts && row !== null && typeof row === 'object'
      ? `  [min_client=${String(row.minimal_client_version)} visibility=${String(row.visibility)}]`
      : ''
    console.log(`     ${id}${label && label !== id ? `  (${String(label)})` : ''}${extra}`)
  }
}

console.log(`auth: token present (${accessToken.length} chars, not printed), account-id ${typeof accountId === 'string' && accountId.length > 0 ? 'present' : 'MISSING'}`)
console.log('')

if (process.env.CODEX_SWEEP === '1') {
  const versions = (process.env.CODEX_VERSIONS ?? '0.150.1,0.153.0,0.155.0,0.158.0,0.159.0,0.200.0').split(',')
  let baseline
  for (const version of versions) {
    const result = await list(version)
    console.log(`===== client_version=${version} =====`)
    report(result)
    if (result.rows !== undefined) {
      const ids = result.rows.map(idOf).sort()
      if (baseline === undefined) baseline = { version, ids }
      else {
        const added = ids.filter(id => !baseline.ids.includes(id))
        const removed = baseline.ids.filter(id => !ids.includes(id))
        console.log(`     vs ${baseline.version}: +[${added.join(', ')}] -[${removed.join(', ')}]`)
      }
    }
    console.log('')
  }
  process.exit(0)
}

// The default run reproduces the plugin's own request exactly: no query string.
const clientVersion = process.env.CODEX_CLIENT_VERSION
console.log(clientVersion === undefined
  ? 'mode: exact plugin request (no client_version)'
  : `mode: client_version=${clientVersion}`)
console.log('')
const result = await list(clientVersion)
report(result, { facts: process.env.CODEX_FACTS === '1' })

if (result.rows === undefined) {
  console.log('')
  console.log('This is the failure the live overlay swallows: the refresh cannot see')
  console.log('newly released models because the listing call itself is rejected.')
  // Set the code rather than calling process.exit: undici keeps sockets alive,
  // and exiting under them trips a libuv assertion on Windows.
  process.exitCode = 4
} else {
  const ids = result.rows.map(idOf)
  const six = ids.filter(id => /^gpt-6/i.test(id))
  console.log('')
  console.log(six.length > 0
    ? `gpt-6.x reported: ${six.join(', ')}`
    : 'no gpt-6.x reported for this client version')
}
