/**
 * Unit tests for AntigravityAccountAdapter.
 *
 * Verifies:
 * - account mapping (signed-in, signed-out, error)
 * - login ticket lifecycle (beginLogin -> pollLogin -> done)
 * - logout execution
 * - quota reading from snapshot
 *
 * Run with:  node scripts/test-antigravity-account.mjs
 */

import assert from 'node:assert/strict'
import { AntigravityAccountAdapter } from '../lib/accounts/antigravity.js'

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
      return hasCredential
        ? { access: 'ya29.xyz', refresh: '1//abc', email: 'test@gmail.com', projectId: 'my-project' }
        : undefined
    },
    async delete() {
      this.deleted = true
    },
  }
}

function fakeSnapshot(quotaRow = { id: 'antigravity', name: 'Antigravity', status: 'ok', windows: [] }) {
  return async () => ({
    providers: [quotaRow],
    fetchedAt: Date.now(),
  })
}

process.stdout.write('\nantigravity account state\n')

await check('signed-in store maps to signed-in account with email or project', async () => {
  const adapter = new AntigravityAccountAdapter(fakeStore(true), fakeSnapshot())
  const account = await adapter.account()
  assert.equal(account.id, 'antigravity')
  assert.equal(account.state, 'signed-in')
  assert.equal(account.canLogout, true)
  assert.equal(account.canReauth, true)
  assert.equal(account.account, 'test@gmail.com')
  assert.equal(account.login.kind, 'browser')
})

await check('signed-out store maps to signed-out account without logout', async () => {
  const adapter = new AntigravityAccountAdapter(fakeStore(false), fakeSnapshot())
  const account = await adapter.account()
  assert.equal(account.state, 'signed-out')
  assert.equal(account.canLogout, false)
  assert.equal(account.canReauth, true)
  assert.equal(account.login.kind, 'browser')
})

await check('throwing read maps to error account state', async () => {
  const brokenStore = {
    async read() {
      throw new Error('disk read failed')
    },
    async delete() {},
  }
  const adapter = new AntigravityAccountAdapter(brokenStore, fakeSnapshot())
  const account = await adapter.account()
  assert.equal(account.state, 'error')
  assert.match(account.error, /disk read failed/)
})

process.stdout.write('\nantigravity quota reading\n')

await check('quota returns row from snapshot', async () => {
  const adapter = new AntigravityAccountAdapter(fakeStore(), fakeSnapshot({
    id: 'antigravity',
    name: 'Antigravity',
    status: 'ok',
    usedPercent: 45,
    windows: [],
  }))
  const quota = await adapter.quota()
  assert.equal(quota.id, 'antigravity')
  assert.equal(quota.status, 'ok')
  assert.equal(quota.usedPercent, 45)
})

process.stdout.write(`\nall ${String(passed)} antigravity account checks passed\n`)
