/**
 * Tests for the Grok account adapter.
 *
 * The adapter is the reference implementation of the unified login face, so the
 * ticket state machine is worth locking down: it is the one piece of the merge
 * that a user interacts with under time pressure (a device code expires) and
 * where a wrong answer is invisible — the UI would simply keep spinning.
 *
 * A fake service stands in for the ported `GrokAuthService`, so no auth file,
 * network call, or spawned process is involved. The fakes are shaped to the
 * adapter's own narrow usage of the service, which keeps this suite honest: if
 * the adapter starts reading a field the fake does not provide, the test fails
 * rather than silently passing.
 *
 * Run with:  node scripts/test-grok-account.mjs
 */
import { strict as assert } from 'node:assert'

import { GrokAccountAdapter, createGrokQuotaReader } from '../lib/accounts/grok.js'

let passed = 0

/**
 * Run one named check, accepting sync or async bodies.
 * @param name - the check's description.
 * @param fn - the check body.
 */
async function check(name, fn) {
  await fn()
  passed += 1
  process.stdout.write(`  ok   ${name}\n`)
}

/**
 * A fake auth service exposing only what the adapter consumes.
 *
 * `login()` records its mode so a test can assert which flow was requested;
 * `status()` answers whatever the current scenario set.
 * @param overrides - scenario overrides.
 * @returns the fake service plus its recording state.
 */
function fakeService(overrides = {}) {
  const state = {
    status: { available: true, configured: false, authFileExists: false, credentialRef: 'GROK_OAUTH_TOKEN' },
    usage: {},
    usageCalls: 0,
    loginMode: undefined,
    loginReply: { started: true, userCode: 'ABCD-1234', verificationUri: 'https://x.ai/device', expiresInSeconds: 300 },
    failLogin: false,
    ...overrides,
  }
  return {
    state,
    async status() {
      return state.status
    },
    async usage() {
      state.usageCalls += 1
      return state.usage
    },
    async login(mode) {
      state.loginMode = mode
      if (state.failLogin) throw new Error('the grok CLI is not on PATH')
      return state.loginReply
    },
  }
}

/**
 * Build an adapter over a fake service and a fake snapshot reader.
 *
 * The snapshot thunk is what `quota()` now reads (the collector already reads
 * Grok through the service, so a second service call would double the upstream
 * traffic). Tests that do not care about quota get a snapshot holding one
 * healthy Grok row.
 * @param service - the fake auth service.
 * @param snapshot - the snapshot to answer, or a thunk producing one.
 * @returns the adapter under test.
 */
function adapterFor(service, snapshot = { providers: [quotaRow()], fetchedAt: 0 }) {
  return new GrokAccountAdapter(
    service,
    async () => (typeof snapshot === 'function' ? await snapshot() : snapshot),
  )
}

/** A healthy Grok quota row, so account tests are unaffected by quota state. */
function quotaRow(overrides = {}) {
  return {
    id: 'grok', name: 'Grok', status: 'ok', windows: [], fetchedAt: Date.now(), usedPercent: 25,
    ...overrides,
  }
}

process.stdout.write('\naccount state\n')

await check('a configured credential reads as signed in with its email', async () => {
  const service = fakeService({
    status: { available: true, configured: true, authFileExists: true, credentialRef: 'x', email: 'a@b.c' },
  })
  const account = await adapterFor(service).account()
  assert.equal(account.state, 'signed-in')
  assert.equal(account.account, 'a@b.c')
})

await check('a missing credential reads as signed out, not as an error', async () => {
  const account = await adapterFor(fakeService()).account()
  assert.equal(account.state, 'signed-out')
  assert.equal(account.error, undefined)
})

await check('a recorded login failure is surfaced as an error state', async () => {
  const service = fakeService({
    status: { available: true, configured: false, authFileExists: false, credentialRef: 'x', lastLoginError: 'denied' },
  })
  const account = await adapterFor(service).account()
  assert.equal(account.state, 'error')
  assert.equal(account.error, 'denied')
})

await check('a throwing status read degrades to an error row instead of throwing', async () => {
  const account = await adapterFor({
    async status() { throw new Error('disk on fire') },
    async usage() { return {} },
    async login() { return { started: false } },
  }).account()
  assert.equal(account.state, 'error')
  assert.match(account.error, /disk on fire/)
})

await check('no logout is claimed', async () => {
  const service = fakeService({ status: { available: true, configured: true, authFileExists: true, credentialRef: 'x' } })
  const account = await adapterFor(service).account()
  assert.equal(account.canLogout, false)
  // But re-authentication IS offered: the two are independent capabilities.
  assert.equal(account.canReauth, true)
})

process.stdout.write('\nlogin method selection\n')

await check('an idle grok offers to fetch a device code', async () => {
  const account = await adapterFor(fakeService()).account()
  // `device-request`, not `cli`: the button runs the Host device flow, so the
  // instruction must describe what the button does.
  assert.equal(account.login.kind, 'device-request')
})

await check('the CLI is offered as an alternative when it is installed', async () => {
  const account = await adapterFor(fakeService()).account()
  assert.equal(account.login.cliCommand, 'grok login')
})

await check('no CLI alternative is advertised when the CLI is absent', async () => {
  const service = fakeService({
    status: { available: false, configured: false, authFileExists: false, credentialRef: 'x' },
  })
  const account = await adapterFor(service).account()
  assert.equal(account.login.kind, 'device-request')
  assert.equal(account.login.cliCommand, undefined)
})

await check('a pending device login is shown instead of the request hint', async () => {
  const service = fakeService({
    status: {
      available: true, configured: false, authFileExists: false, credentialRef: 'x',
      pendingLogin: { userCode: 'WXYZ', verificationUri: 'https://x.ai/d', expiresAt: '2030-01-01T00:00:00.000Z' },
    },
  })
  const account = await adapterFor(service).account()
  assert.equal(account.login.kind, 'device')
  assert.equal(account.login.userCode, 'WXYZ')
})

await check('a signed-in account still reports a usable login method', async () => {
  // The regression: the view gated its button on `!signedIn`, so a valid
  // credential had no way to re-authenticate from the UI at all.
  const service = fakeService({
    status: { available: true, configured: true, authFileExists: true, credentialRef: 'x', email: 'a@b.c' },
  })
  const account = await adapterFor(service).account()
  assert.equal(account.state, 'signed-in')
  assert.equal(account.canReauth, true)
  assert.notEqual(account.login.kind, 'none')
})

process.stdout.write('\nlogin ticket lifecycle\n')

await check('beginLogin requests the device flow and returns the code', async () => {
  const service = fakeService()
  const ticket = await adapterFor(service).beginLogin()
  // Device rather than CLI: only the Host-run flow is observable, so only it
  // can drive a polling ticket.
  assert.equal(service.state.loginMode, 'device')
  assert.equal(ticket.done, false)
  assert.equal(ticket.method.kind, 'device')
  assert.equal(ticket.method.userCode, 'ABCD-1234')
})

await check('a device reply without a code settles immediately as an error', async () => {
  const service = fakeService({ loginReply: { started: true } })
  const ticket = await adapterFor(service).beginLogin()
  assert.equal(ticket.done, true)
  assert.equal(ticket.method.kind, 'none')
  assert.ok(ticket.error !== undefined)
})

await check('polling stays open while the user has not approved', async () => {
  const service = fakeService({
    status: {
      available: true, configured: false, authFileExists: false, credentialRef: 'x',
      pendingLogin: { userCode: 'ABCD-1234', verificationUri: 'https://x.ai/d', expiresAt: '2030-01-01T00:00:00.000Z' },
    },
  })
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, false)
  assert.equal(polled.method.kind, 'device')
})

await check('polling completes once the credential appears', async () => {
  const service = fakeService()
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  // The credential appearing IS the completion signal: the adapter reads
  // `status().configured` rather than tracking success itself.
  service.state.status = { available: true, configured: true, authFileExists: true, credentialRef: 'x' }
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, true)
  assert.equal(polled.error, undefined)
})

await check('polling reports a failure the service recorded', async () => {
  const service = fakeService()
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  service.state.status = {
    available: true, configured: false, authFileExists: false, credentialRef: 'x', lastLoginError: 'authorization was denied',
  }
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, true)
  assert.equal(polled.error, 'authorization was denied')
})

await check('polling after expiry reports it rather than hanging', async () => {
  const service = fakeService({ loginReply: { started: true, userCode: 'C', verificationUri: 'https://x/', expiresInSeconds: 0 } })
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, true)
  assert.match(polled.error, /过期/)
})

await check('a second login supersedes the first ticket', async () => {
  const service = fakeService()
  const adapter = adapterFor(service)
  const first = await adapter.beginLogin()
  const second = await adapter.beginLogin()
  assert.notEqual(first.id, second.id)
  // The superseded ticket must not be honoured even though the attempt it named
  // is notionally still in flight.
  const stale = await adapter.pollLogin(first.id)
  assert.equal(stale.done, true)
  assert.ok(stale.error !== undefined)
})

await check('an unknown ticket id does not adopt the live attempt', async () => {
  const service = fakeService()
  const adapter = adapterFor(service)
  await adapter.beginLogin()
  // Adopting the current attempt's state here would let a stale UI render a
  // success that belongs to a different login.
  service.state.status = { available: true, configured: true, authFileExists: true, credentialRef: 'x' }
  const polled = await adapter.pollLogin('grok-does-not-exist')
  assert.equal(polled.done, true)
  assert.ok(polled.error !== undefined)
})

process.stdout.write('\nre-authentication (the reported bug)\n')

/** A service that is already signed in, for re-auth scenarios. */
function signedInService() {
  return fakeService({
    status: { available: true, configured: true, authFileExists: true, credentialRef: 'x', email: 'first@example.com' },
  })
}

await check('re-auth does not report success before the user does anything', async () => {
  // The bug behind "I cannot log in from the Grok tab": for an
  // already-signed-in provider, a poll that keyed completion on `configured`
  // alone saw an already-true flag and closed the ticket instantly. The user
  // pressed 登录 and nothing happened.
  const service = signedInService()
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, false, 'a re-auth poll must not settle while no code has been seen')
})

await check('re-auth stays open while the device code is live', async () => {
  const service = signedInService()
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  service.state.status = {
    ...service.state.status,
    pendingLogin: { userCode: 'RE-AUTH', verificationUri: 'https://x.ai/d', expiresAt: '2030-01-01T00:00:00.000Z' },
  }
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, false)
  assert.equal(polled.method.kind, 'device')
})

await check('re-auth completes once the code clears after being seen', async () => {
  const service = signedInService()
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  // The code appears...
  service.state.status = {
    ...service.state.status,
    pendingLogin: { userCode: 'RE-AUTH', verificationUri: 'https://x.ai/d', expiresAt: '2030-01-01T00:00:00.000Z' },
  }
  await adapter.pollLogin(started.id)
  // ...and then clears, which is the completion event for a re-auth.
  service.state.status = { ...service.state.status, pendingLogin: undefined }
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, true)
  assert.equal(polled.error, undefined)
})

await check('a fresh login still completes on the credential appearing', async () => {
  // The counterpart: for a signed-out provider the credential appearing IS the
  // event, and requiring a code to have been seen would break the common case.
  const service = fakeService()
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  service.state.status = { available: true, configured: true, authFileExists: true, credentialRef: 'x' }
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, true)
})

await check('a fresh login stays open until the code is published', async () => {
  // The service starts the device flow asynchronously, so the first poll can
  // land before the code exists. Settling here would fail a login that is
  // merely still starting.
  const service = fakeService()
  const adapter = adapterFor(service)
  const started = await adapter.beginLogin()
  const polled = await adapter.pollLogin(started.id)
  assert.equal(polled.done, false)
})

process.stdout.write('\nquota mapping\n')

await check('quota is read from the shared snapshot, not a second service call', async () => {
  // Reading the service again here would double upstream traffic and could
  // report a different moment than the ring beside it.
  const service = fakeService()
  let calls = 0
  const adapter = new GrokAccountAdapter(service, async () => {
    calls += 1
    return { providers: [quotaRow({ usedPercent: 42 })], fetchedAt: 0 }
  })
  const quota = await adapter.quota()
  assert.equal(quota.usedPercent, 42)
  assert.equal(calls, 1)
  // The service's own usage path must not have been touched.
  assert.equal(service.state.usageCalls, 0)
})

await check('a provider missing from the snapshot is an error, not a blank success', async () => {
  const adapter = new GrokAccountAdapter(fakeService(), async () => ({ providers: [], fetchedAt: 0 }))
  const quota = await adapter.quota()
  assert.equal(quota.status, 'error')
  assert.equal(quota.usedPercent, undefined)
})

await check('a throwing snapshot read degrades to an error row', async () => {
  const adapter = new GrokAccountAdapter(fakeService(), async () => { throw new Error('collector down') })
  const quota = await adapter.quota()
  assert.equal(quota.status, 'error')
  assert.match(quota.error, /collector down/)
})

await check('an unconfigured snapshot row is passed through unchanged', async () => {
  // The rail's own verdict must not be second-guessed here: one reader of the
  // credential, one answer.
  const adapter = new GrokAccountAdapter(fakeService(), async () => ({
    providers: [quotaRow({ status: 'unconfigured', usedPercent: undefined, error: 'not signed in' })],
    fetchedAt: 0,
  }))
  const quota = await adapter.quota()
  assert.equal(quota.status, 'unconfigured')
  assert.equal(quota.error, 'not signed in')
})

process.stdout.write('\nusage mapping (through the collector reader)\n')

await check('remaining percent is inverted into consumed percent', async () => {
  const reader = createGrokQuotaReader(fakeService({ usage: { weeklyRemainingPercent: 75 } }))
  const quota = await reader()
  assert.equal(quota.status, 'ok')
  // The rail meters consumption; upstream reports what is left.
  assert.equal(quota.usedPercent, 25)
})

await check('a reset time is carried through', async () => {
  const reader = createGrokQuotaReader(
    fakeService({ usage: { weeklyRemainingPercent: 0, weeklyResetAt: '2030-01-01T00:00:00.000Z' } }),
  )
  const quota = await reader()
  assert.equal(quota.windows[0].resetAt, '2030-01-01T00:00:00.000Z')
})

await check('an absent percentage while signed in is an error, never a misleading 0%', async () => {
  // "Unknown" and "untouched" must not render identically: a full ring would
  // read as a full tank when the truth is that nothing was read.
  const reader = createGrokQuotaReader(fakeService({
    status: { available: true, configured: true, authFileExists: true, credentialRef: 'x' },
    usage: {},
  }))
  const quota = await reader()
  assert.equal(quota.status, 'error')
  assert.equal(quota.usedPercent, undefined)
})

await check('an absent percentage while signed out reads as unconfigured, not an upstream error', async () => {
  // The distinction the panel renders differently: "sign in" versus "the
  // provider misbehaved". Reporting an unreadable credential as an upstream
  // error sends the user looking in the wrong place.
  const reader = createGrokQuotaReader(fakeService({ usage: {} }))
  const quota = await reader()
  assert.equal(quota.status, 'unconfigured')
  assert.equal(quota.usedPercent, undefined)
  assert.match(quota.error, /凭证不可用/)
})

await check('a signed-in provider with usage reports ok', async () => {
  const reader = createGrokQuotaReader(fakeService({
    status: { available: true, configured: true, authFileExists: true, credentialRef: 'x' },
    usage: { weeklyRemainingPercent: 60 },
  }))
  const quota = await reader()
  assert.equal(quota.status, 'ok')
  assert.equal(quota.usedPercent, 40)
})

await check('a throwing usage read degrades to an error row', async () => {
  const reader = createGrokQuotaReader({
    async status() { return { available: true, configured: true, authFileExists: true, credentialRef: 'x' } },
    async usage() { throw new Error('billing endpoint down') },
    async login() { return { started: false } },
  })
  const quota = await reader()
  assert.equal(quota.status, 'error')
  assert.match(quota.error, /billing endpoint down/)
})

process.stdout.write(`\nall ${String(passed)} grok account checks passed\n`)
