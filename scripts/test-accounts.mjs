/**
 * Tests for the unified account face.
 *
 * These import the COMPILED modules (`lib/accounts/*.js`) rather than a mirror,
 * for the same reason `test-frame.mjs` does: the point of the mapping is that
 * it can be verified for real, so a hand-copied re-implementation would test
 * nothing but itself. Run the tsc step first (`scripts/build.mjs` does).
 *
 * What is locked down here:
 *
 * 1. **Every quota status maps to an account state.** A `ProviderQuota` that
 *    says `unconfigured` must never render as signed in — that is the whole
 *    safety argument for deriving one from the other.
 * 2. **The registry never shortens its list.** One adapter throwing must
 *    produce an error row under its own name, not a missing row. A silently
 *    short list is how a provider disappears from the UI with no trace.
 * 3. **Capability detection drives the UI.** `canLogin`/`canLogout` must answer
 *    false for providers that cannot do it, so no button is offered that would
 *    fail when pressed.
 *
 * Run with:  node scripts/test-accounts.mjs
 */
import { strict as assert } from 'node:assert'

import { accountFromQuota } from '../lib/accounts/adapters.js'
import { AccountRegistry } from '../lib/accounts/registry.js'
import { canLogin, canLogout } from '../lib/accounts/contract.js'

let passed = 0

/**
 * Run one named check, accepting sync or async bodies.
 *
 * Awaiting every case is what keeps a rejected assertion from becoming an
 * unhandled rejection that lets the script exit 0 — a green run that tested
 * nothing.
 * @param name - the check's description.
 * @param fn - the check body.
 */
async function check(name, fn) {
  await fn()
  passed += 1
  process.stdout.write(`  ok   ${name}\n`)
}

/** A minimal quota row; each case overrides only what it tests. */
function quota(overrides = {}) {
  return { id: 'codex', name: 'Codex', status: 'ok', windows: [], fetchedAt: 0, ...overrides }
}

/** A structurally complete adapter, with optional halves toggled per case. */
function adapter(overrides = {}) {
  return {
    id: 'codex',
    async account() {
      return { id: 'codex', name: 'Codex', state: 'signed-out', login: { kind: 'none', reason: 'x' } }
    },
    async quota() {
      return quota()
    },
    ...overrides,
  }
}

process.stdout.write('\naccount mapping\n')

await check('a healthy provider is signed in', () => {
  const account = accountFromQuota('codex', 'Codex', quota())
  assert.equal(account.state, 'signed-in')
  assert.equal(account.error, undefined)
})

await check('an unconfigured provider reads as signed out, never signed in', () => {
  const account = accountFromQuota('grok', 'Grok', quota({ status: 'unconfigured', error: 'not signed in' }))
  assert.equal(account.state, 'signed-out')
  assert.equal(account.error, 'not signed in')
})

await check('an errored provider is distinct from a signed-out one', () => {
  assert.equal(accountFromQuota('codex', 'Codex', quota({ status: 'error', error: 'HTTP 500' })).state, 'error')
})

await check('a missing error message still produces a non-empty reason', () => {
  const account = accountFromQuota('codex', 'Codex', quota({ status: 'error' }))
  assert.ok(account.error !== undefined && account.error.length > 0)
})

await check('an account identity is carried through when reported', () => {
  const account = accountFromQuota('workbuddy', 'WorkBuddy', quota({ id: 'workbuddy', account: 'someone@example.com' }))
  assert.equal(account.account, 'someone@example.com')
})

await check('no account identity is emitted as absent, not as an empty string', () => {
  assert.equal('account' in accountFromQuota('codex', 'Codex', quota()), false)
})

await check('the provider id is preserved verbatim', () => {
  for (const id of ['codex', 'antigravity', 'workbuddy', 'grok']) {
    assert.equal(accountFromQuota(id, id, quota({ id })).id, id)
  }
})

await check('logout capability is opt-in, never assumed', () => {
  // The regression this locks: every provider read as signed-in on the real
  // machine, so a default of `true` put a "sign out" button on four rows whose
  // adapters implement no logout — a control that silently did nothing.
  assert.equal(accountFromQuota('codex', 'Codex', quota()).canLogout, false)
  assert.equal(accountFromQuota('codex', 'Codex', quota(), undefined, true).canLogout, true)
})

await check('re-authentication capability is opt-in too', () => {
  // Same class of bug, caught before it shipped: a "重新登录" button on a
  // provider with no `beginLogin` would fail when pressed.
  assert.equal(accountFromQuota('codex', 'Codex', quota()).canReauth, false)
  assert.equal(accountFromQuota('codex', 'Codex', quota(), undefined, false, true).canReauth, true)
})

await check('logout and re-auth are independent capabilities', () => {
  // A provider may offer either, both, or neither; collapsing them into one flag
  // is what produced the original bug.
  const reauthOnly = accountFromQuota('grok', 'Grok', quota(), undefined, false, true)
  assert.equal(reauthOnly.canLogout, false)
  assert.equal(reauthOnly.canReauth, true)
  const logoutOnly = accountFromQuota('grok', 'Grok', quota(), undefined, true, false)
  assert.equal(logoutOnly.canLogout, true)
  assert.equal(logoutOnly.canReauth, false)
})

await check('a signed-out row still reports its logout capability honestly', () => {
  const account = accountFromQuota('grok', 'Grok', quota({ status: 'unconfigured' }), undefined, true)
  assert.equal(account.state, 'signed-out')
  assert.equal(account.canLogout, true)
})

process.stdout.write('\ncapability detection\n')

await check('an adapter with no login halves cannot log in', () => {
  assert.equal(canLogin(adapter()), false)
})

await check('an adapter with both login halves can log in', () => {
  assert.equal(canLogin(adapter({ beginLogin: async () => ({}), pollLogin: async () => ({}) })), true)
})

await check('a half-implemented login is refused', () => {
  // Present-but-partial is the dangerous shape: offering a control whose second
  // half does not exist would fail only after the user committed to it.
  assert.equal(canLogin(adapter({ beginLogin: async () => ({}) })), false)
  assert.equal(canLogin(adapter({ pollLogin: async () => ({}) })), false)
})

await check('logout is detected independently of login', () => {
  const withLogout = adapter({ logout: async () => {} })
  assert.equal(canLogout(withLogout), true)
  assert.equal(canLogin(withLogout), false)
})

process.stdout.write('\nregistry isolation\n')

await check('an empty registry answers an empty list rather than throwing', async () => {
  const registry = new AccountRegistry([])
  assert.deepEqual(await registry.accounts(), [])
  assert.deepEqual(registry.ids, [])
})

await check('every adapter contributes exactly one row, in construction order', async () => {
  const registry = new AccountRegistry([adapter({ id: 'codex' }), adapter({ id: 'grok' })])
  assert.deepEqual((await registry.accounts()).map(row => row.id), ['codex', 'grok'])
})

await check('a throwing adapter becomes an error row, not a missing row', async () => {
  const registry = new AccountRegistry([
    adapter({ id: 'codex' }),
    adapter({ id: 'grok', async account() { throw new Error('credential file is corrupt') } }),
  ])
  const rows = await registry.accounts()
  // The length assertion is the point: a dropped row would let a broken
  // provider vanish from the UI with no indication anything went wrong.
  assert.equal(rows.length, 2)
  assert.match(rows.find(row => row.id === 'grok').error, /credential file is corrupt/)
})

await check('a throwing adapter does not disturb its neighbours', async () => {
  const registry = new AccountRegistry([
    adapter({ id: 'codex', async account() { throw new Error('boom') } }),
    adapter({ id: 'grok' }),
  ])
  assert.equal((await registry.accounts()).find(row => row.id === 'grok').state, 'signed-out')
})

await check('login and logout on an unknown provider degrade instead of throwing', async () => {
  const registry = new AccountRegistry([])
  assert.equal(await registry.beginLogin('codex'), undefined)
  assert.equal(await registry.pollLogin('codex', 't'), undefined)
  assert.equal(await registry.logout('codex'), false)
})

await check('a provider without a login flow reports no ticket', async () => {
  const registry = new AccountRegistry([adapter()])
  assert.equal(await registry.beginLogin('codex'), undefined)
  assert.equal(await registry.logout('codex'), false)
})

await check('a real login flow is reached and its ticket returned', async () => {
  const registry = new AccountRegistry([
    adapter({
      beginLogin: async () => ({
        id: 't1',
        method: { kind: 'device', userCode: 'ABCD', verificationUri: 'https://x/', expiresAt: '' },
        done: false,
      }),
      pollLogin: async () => ({ id: 't1', method: { kind: 'none', reason: '' }, done: true }),
    }),
  ])
  const ticket = await registry.beginLogin('codex')
  assert.equal(ticket.id, 't1')
  assert.equal(ticket.method.kind, 'device')
  assert.equal((await registry.pollLogin('codex', 't1')).done, true)
})

process.stdout.write(`\nall ${String(passed)} account checks passed\n`)
