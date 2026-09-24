/**
 * Unit tests for CodexAccountAdapter.
 *
 * Verifies:
 * - account mapping (signed-in, signed-out, error)
 * - login ticket lifecycle (beginLogin -> pollLogin -> done)
 * - logout capability and execution
 * - quota reading from snapshot
 *
 * Run with:  node scripts/test-codex-account.mjs
 */

import assert from 'node:assert/strict'
import { CodexAccountAdapter } from '../lib/accounts/codex.js'

let passed = 0

async function check(name, run) {
  try {
    await run()
    passed += 1
    process.stdout.write(`  ok   ${name}\n`)
  } catch (error) {
    process.stderr.write(`  fail ${name}: ${error instanceof Error ? error.message : String(error)}\n`)
    throw error
  }
}

function fakeStore(hasCredential = true) {
  return {
    deleted: false,
    async read() {
      return hasCredential ? { type: 'oauth', expires: Date.now() + 3600_000 } : undefined
    },
    async delete() {
      this.deleted = true
    },
  }
}

function fakeWebAuth(statusValue = { status: 'signed-in' }) {
  return {
    currentStatus: statusValue,
    signedOutCalled: false,
    async status() {
      return this.currentStatus
    },
    async signIn() {
      return { url: 'https://auth.openai.com/oauth/authorize?client_id=123' }
    },
    async signOut() {
      this.signedOutCalled = true
      this.currentStatus = { status: 'signed-out' }
    },
  }
}

function fakeSnapshot(quotaRow = { id: 'codex', name: 'Codex', status: 'ok', windows: [] }) {
  return async () => ({
    providers: [quotaRow],
    fetchedAt: Date.now(),
  })
}

process.stdout.write('\ncodex account state\n')

await check('signed-in web auth maps to signed-in account with logout and reauth', async () => {
  const adapter = new CodexAccountAdapter(fakeStore(true), fakeWebAuth({ status: 'signed-in' }), fakeSnapshot())
  const account = await adapter.account()
  assert.equal(account.id, 'codex')
  assert.equal(account.state, 'signed-in')
  assert.equal(account.canLogout, true)
  assert.equal(account.canReauth, true)
  assert.equal(account.login.kind, 'browser')
  assert.equal(account.login.pending, false)
})

await check('signed-out web auth maps to signed-out account without logout', async () => {
  const adapter = new CodexAccountAdapter(fakeStore(false), fakeWebAuth({ status: 'signed-out' }), fakeSnapshot())
  const account = await adapter.account()
  assert.equal(account.state, 'signed-out')
  assert.equal(account.canLogout, false)
  assert.equal(account.canReauth, true)
  assert.equal(account.login.kind, 'browser')
  assert.equal(account.login.pending, false)
})

await check('signing-in web auth reflects pending in browser login method', async () => {
  const adapter = new CodexAccountAdapter(fakeStore(false), fakeWebAuth({ status: 'signing-in' }), fakeSnapshot())
  const account = await adapter.account()
  assert.equal(account.login.kind, 'browser')
  assert.equal(account.login.pending, true)
})

await check('web auth error surfaces on account error field', async () => {
  const adapter = new CodexAccountAdapter(fakeStore(false), fakeWebAuth({ status: 'error', message: 'network down' }), fakeSnapshot())
  const account = await adapter.account()
  assert.equal(account.state, 'error')
  assert.equal(account.error, 'network down')
})

process.stdout.write('\ncodex login & logout lifecycle\n')

await check('beginLogin mints ticket and returns challenge URL', async () => {
  const webAuth = fakeWebAuth({ status: 'signed-out' })
  const adapter = new CodexAccountAdapter(fakeStore(false), webAuth, fakeSnapshot())
  const ticket = await adapter.beginLogin()
  assert.equal(ticket.done, false)
  assert.equal(ticket.method.kind, 'browser')
  assert.match(ticket.method.url, /auth\.openai\.com/)
  assert.equal(ticket.method.pending, true)
})

await check('pollLogin stays open while still signing in', async () => {
  const webAuth = fakeWebAuth({ status: 'signed-out' })
  const adapter = new CodexAccountAdapter(fakeStore(false), webAuth, fakeSnapshot())
  const ticket = await adapter.beginLogin()
  webAuth.currentStatus = { status: 'signing-in' }
  const polled = await adapter.pollLogin(ticket.id)
  assert.equal(polled.done, false)
  assert.equal(polled.method.kind, 'browser')
  assert.equal(polled.method.pending, true)
})

await check('pollLogin completes when status switches to signed-in', async () => {
  const webAuth = fakeWebAuth({ status: 'signed-out' })
  const adapter = new CodexAccountAdapter(fakeStore(false), webAuth, fakeSnapshot())
  const ticket = await adapter.beginLogin()
  webAuth.currentStatus = { status: 'signed-in' }
  const polled = await adapter.pollLogin(ticket.id)
  assert.equal(polled.done, true)
  assert.equal(polled.method.kind, 'browser')
  assert.equal(polled.method.pending, false)
})

await check('logout invokes signOut and clears credential store', async () => {
  const store = fakeStore(true)
  const webAuth = fakeWebAuth({ status: 'signed-in' })
  const adapter = new CodexAccountAdapter(store, webAuth, fakeSnapshot())
  await adapter.logout()
  assert.equal(webAuth.signedOutCalled, true)
  assert.equal(store.deleted, true)
})

process.stdout.write('\ncodex quota reading\n')

await check('quota returns row from snapshot', async () => {
  const adapter = new CodexAccountAdapter(fakeStore(), fakeWebAuth(), fakeSnapshot({
    id: 'codex',
    name: 'Codex',
    status: 'ok',
    usedPercent: 30,
    windows: [],
  }))
  const quota = await adapter.quota()
  assert.equal(quota.id, 'codex')
  assert.equal(quota.status, 'ok')
  assert.equal(quota.usedPercent, 30)
})

process.stdout.write(`\nall ${String(passed)} codex account checks passed\n`)
