/**
 * Smoke-test the account registry against the real machine.
 *
 * Unlike `test-accounts.mjs` (which locks invariants with fakes), this runs the
 * actual adapters against whatever credentials exist on this machine. It is a
 * manual diagnostic, not part of `npm run build`: its outcome depends on which
 * providers happen to be signed in, so it must never gate the build.
 *
 * Pass `--grok` to include the real Grok adapter. It is opt-in because that
 * adapter constructs a live `GrokAuthService`, which probes for the `grok` CLI
 * and (on a device login) would contact auth.x.ai — side effects a plain
 * account read should not have.
 *
 * Run with:  node scripts/probe-accounts.mjs [--grok]
 */
import { createQuotaBackedAdapters } from '../lib/accounts/adapters.js'
import { CodexAccountAdapter } from '../lib/accounts/codex.js'
import { AntigravityAccountAdapter } from '../lib/accounts/antigravity.js'
import { createGrokQuotaReader, GrokAccountAdapter } from '../lib/accounts/grok.js'
import { OpenAICodexCredentialStore } from '../lib/codex/store.js'
import { OpenAICodexWebAuth } from '../lib/codex/auth-routes.js'
import { FileCredentialStore, credentialPath } from '../lib/antigravity/index.js'
import { AccountRegistry } from '../lib/accounts/registry.js'
import { QuotaCollector } from '../lib/collector.js'
import { GrokAuthService } from '../lib/grok/grok-auth-service.js'
import { defaultAuthJsonPath } from '../lib/grok/grok-auth.js'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '../lib/home.js'

const withGrok = process.argv.includes('--grok')

const context = {
  home: resolveDshHome(),
  async credential() {
    return undefined
  },
  warn(provider, message) {
    process.stderr.write(`warn ${provider}: ${message}\n`)
  },
}

// The loopback origin is irrelevant to reads that go straight to a credential
// file; a placeholder keeps this diagnostic self-contained.
const pluginBase = () => 'http://127.0.0.1:3080'

// Build the same wiring `index.ts` does, so this diagnostic exercises the real
// paths rather than a simplified stand-in.
const adapters = []
let grokReader
if (withGrok) {
  const service = new GrokAuthService(
    {
      // Mirror cordis's printf-style logger, which is what the plugin passes
      // through in index.ts. Joining the args instead would print the raw `%s`
      // placeholders and make a real diagnostic unreadable.
      logger: {
        warn: (message, ...args) => {
          let i = 0
          const rendered = String(message).replace(/%[sd]/gu, () => String(args[i++]))
          process.stderr.write(`grok: ${rendered}\n`)
        },
      },
      effect: () => {},
    },
    { authJsonPath: defaultAuthJsonPath(), grokCommand: 'grok', credentialRef: credentialRef('GROK_OAUTH_TOKEN') },
  )
  grokReader = createGrokQuotaReader(service)
  adapters.push(new GrokAccountAdapter(service, async () => await collector.snapshot()))
}

const collector = new QuotaCollector({
  context,
  pluginBase: pluginBase(),
  intervalMs: 60_000,
  warn: message => { process.stderr.write(`collector: ${message}\n`) },
  ...(grokReader === undefined ? {} : { overrides: { grok: grokReader } }),
})

const codexStore = new OpenAICodexCredentialStore()
const codexWebAuth = new OpenAICodexWebAuth(codexStore)
adapters.unshift(new CodexAccountAdapter(codexStore, codexWebAuth, async () => await collector.snapshot()))

const antigravityStore = new FileCredentialStore(credentialPath())
adapters.push(new AntigravityAccountAdapter(antigravityStore, async () => await collector.snapshot()))

adapters.push(...createQuotaBackedAdapters(async () => await collector.snapshot()))

const registry = new AccountRegistry(adapters)

process.stdout.write(`dsh home: ${context.home}\n`)
process.stdout.write(`grok adapter: ${withGrok ? 'included' : 'skipped (pass --grok)'}\n\n`)

const rows = await registry.accounts()
for (const row of rows) {
  const logout = row.canLogout ? 'logout' : '-'
  process.stdout.write(
    `${row.id.padEnd(12)} ${row.state.padEnd(11)} ${(row.account ?? '-').padEnd(28)} login=${row.login.kind.padEnd(8)} ${logout}\n`,
  )
  if (row.error !== undefined) process.stdout.write(`${''.padEnd(12)} error: ${row.error}\n`)
}

// A second read must be stable: an adapter whose `account()` disagreed with
// itself between calls would make the UI flicker.
const again = await registry.accounts()
const stable = rows.every((row, index) => row.id === again[index].id && row.state === again[index].state)
process.stdout.write(`\nrepeat read stable: ${String(stable)}\n`)
process.stdout.write(`rows: ${String(rows.length)} (must equal registered adapters: ${String(registry.ids.length)})\n`)
