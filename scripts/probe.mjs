/**
 * Live probe for the host half: reads every provider once and prints the
 * normalized snapshot, exactly as the sidebar would receive it.
 *
 * This is a development aid, not part of the shipped plugin — it is the
 * fastest way to see whether a vendor changed its payload shape.
 *
 * Run with:  node scripts/probe.mjs
 */
import { QuotaCollector } from '../lib/collector.js'
import { resolveDshHome } from '../lib/home.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Resolve a credential ref from the DSH credentials document. */
async function credential(ref) {
  try {
    const raw = await readFile(join(resolveDshHome(), '.credentials.yaml'), 'utf8')
    const match = new RegExp(`^\\s*${ref}:\\s*(\\S+)\\s*$`, 'mu').exec(raw)
    return match?.[1]
  } catch {
    return undefined
  }
}

const collector = new QuotaCollector({
  context: {
    home: resolveDshHome(),
    credential,
    warn: (provider, message) => console.error(`[warn] ${provider}: ${message}`),
  },
  pluginBase: process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080',
  intervalMs: 60_000,
  warn: message => console.error(`[warn] ${message}`),
})

const snapshot = await collector.refresh()
for (const provider of snapshot.providers) {
  const headline = provider.usedPercent === undefined ? '—' : `${String(provider.usedPercent)}%`
  console.log(`\n=== ${provider.name} (${provider.id}) [${provider.status}] ${headline}`)
  if (provider.plan !== undefined) console.log(`    plan:    ${provider.plan}`)
  if (provider.account !== undefined) console.log(`    account: ${provider.account}`)
  if (provider.balance !== undefined) console.log(`    balance: ${provider.balance}`)
  for (const window of provider.windows) {
    const used = window.usedPercent === undefined ? '  —  ' : `${String(window.usedPercent).padStart(5)}%`
    const reset = window.resetAt === undefined ? '' : `  reset ${window.resetAt}`
    const detail = window.detail === undefined ? '' : `  (${window.detail})`
    console.log(`    · ${used}  ${window.label} [${window.kind}]${reset}${detail}`)
  }
  if (provider.error !== undefined) console.log(`    error:   ${provider.error}`)
}
console.log(`\nsnapshot fetchedAt=${new Date(snapshot.fetchedAt).toISOString()}`)
collector.dispose()
