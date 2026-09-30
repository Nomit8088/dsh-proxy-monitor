/**
 * Live Codex model discovery: the request, the gate, and what it reports.
 *
 * Every case here is a failure that actually shipped. The listing endpoint
 * requires `client_version` (400 without it), gates the catalog by that value,
 * returns bodies far larger than the original size cap, marks internal models
 * `visibility: "hide"`, and used to swallow all of it silently — so "I hit
 * refresh and the new model never appeared" had no visible cause.
 *
 * Run with:  node scripts/test-codex-live-models.mjs
 */

import assert from 'node:assert/strict'
import {
  CodexLiveModelCatalog,
  LIVE_CODEX_CLIENT_VERSION,
  liveCodexModelsUrl,
  parseLiveCodexModels,
} from '../lib/codex/live-models.js'
import { isSemverLike } from '../lib/codex/tool-policy.js'

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

/** A response stub; `fetch`-shaped enough for the catalog. */
function respond({ status = 200, body = '{}', ok } = {}) {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    async text() { return body },
    body: { async cancel() {} },
  }
}

/** A listing entry in the shape the live endpoint returns. */
function entry(slug, extra = {}) {
  return { slug, display_name: slug, visibility: 'list', context_window: 100000, ...extra }
}

process.stdout.write('\nlive listing request\n')

await check('the default URL carries a semver client_version', async () => {
  const url = new URL(liveCodexModelsUrl())
  assert.equal(url.pathname, '/backend-api/codex/models')
  const version = url.searchParams.get('client_version')
  assert.equal(version, LIVE_CODEX_CLIENT_VERSION)
  assert.ok(isSemverLike(version), `default must be semver, got ${String(version)}`)
})

await check('the shipped default is claimed when no override is set', async () => {
  let seen
  const catalog = new CodexLiveModelCatalog({
    resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
    fetchImpl: async url => { seen = String(url); return respond() },
  })
  await catalog.refresh()
  assert.equal(new URL(seen).searchParams.get('client_version'), LIVE_CODEX_CLIENT_VERSION)
})

await check('an override is read per attempt, not captured at construction', async () => {
  // A live settings change must reach the next refresh without a reload.
  let version = '1.0.0'
  const seen = []
  const catalog = new CodexLiveModelCatalog({
    resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
    fetchImpl: async url => { seen.push(String(url)); return respond() },
    clientVersion: () => version,
  })
  await catalog.refresh()
  version = '2.0.0'
  await catalog.refresh()
  assert.equal(new URL(seen[0]).searchParams.get('client_version'), '1.0.0')
  assert.equal(new URL(seen[1]).searchParams.get('client_version'), '2.0.0')
})

await check('an empty override falls back to the shipped default', async () => {
  let seen
  const catalog = new CodexLiveModelCatalog({
    resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
    fetchImpl: async url => { seen = String(url); return respond() },
    clientVersion: () => '',
  })
  await catalog.refresh()
  assert.equal(new URL(seen).searchParams.get('client_version'), LIVE_CODEX_CLIENT_VERSION)
})

process.stdout.write('\nlisting response handling\n')

await check('internal models are not synthesized into the picker', async () => {
  // The live endpoint returns these with visibility "hide"; without the filter
  // they become selectable because the plugin is the only source for them.
  const facts = parseLiveCodexModels({
    models: [
      entry('gpt-6.1-sol'),
      entry('gpt-reserve', { visibility: 'hide' }),
      entry('codex-auto-review', { visibility: 'hide' }),
    ],
  })
  assert.deepEqual(facts.map(f => f.id), ['gpt-6.1-sol'])
})

await check('visible models still parse with their display name and window', async () => {
  const facts = parseLiveCodexModels({
    models: [entry('gpt-6.1-sol', { display_name: 'GPT-6.1-Sol', context_window: 272000 })],
  })
  assert.deepEqual(facts, [{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', contextWindow: 272000 }])
})

await check('a body larger than the old cap is still accepted', async () => {
  // The real payload measured ~595 KB of per-model instructions and schemas,
  // which the original 512 KB ceiling rejected outright.
  const filler = 'x'.repeat(700 * 1024)
  const body = JSON.stringify({ models: [entry('gpt-6.1-sol', { padding: filler })] })
  assert.ok(body.length > 512 * 1024, 'fixture must exceed the retired cap')
  const catalog = new CodexLiveModelCatalog({
    resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
    fetchImpl: async () => respond({ body }),
  })
  const facts = await catalog.refresh()
  assert.deepEqual(facts.map(f => f.id), ['gpt-6.1-sol'])
})

await check('a non-200 listing is reported rather than silently skipped', async () => {
  // The shipped bug: 400 was logged and forgotten, so the UI showed a stale
  // catalog with no indication the refresh had failed.
  const statuses = []
  const catalog = new CodexLiveModelCatalog({
    resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
    fetchImpl: async () => respond({ status: 400, ok: false, body: '{}' }),
    onStatus: status => statuses.push(status),
  })
  await catalog.refresh()
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0].ok, false)
  assert.match(String(statuses[0].error), /400/)
  assert.equal(statuses[0].clientVersion, LIVE_CODEX_CLIENT_VERSION)
})

await check('a successful listing reports how many models it found', async () => {
  const statuses = []
  const catalog = new CodexLiveModelCatalog({
    resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
    fetchImpl: async () => respond({ body: JSON.stringify({ models: [entry('gpt-6.1-sol')] }) }),
    onStatus: status => statuses.push(status),
  })
  await catalog.refresh()
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0].ok, true)
  assert.equal(statuses[0].count, 1)
})

await check('being signed out is reported as such, not as an empty catalog', async () => {
  const statuses = []
  const catalog = new CodexLiveModelCatalog({
    resolveAuth: async () => undefined,
    fetchImpl: async () => respond(),
    onStatus: status => statuses.push(status),
  })
  await catalog.refresh()
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0].ok, false)
  assert.match(String(statuses[0].error), /signed in/i)
})

await check('a throwing status observer cannot break the listing', async () => {
  const catalog = new CodexLiveModelCatalog({
    resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
    fetchImpl: async () => respond({ body: JSON.stringify({ models: [entry('gpt-6.1-sol')] }) }),
    onStatus: () => { throw new Error('observer blew up') },
  })
  const facts = await catalog.refresh()
  assert.deepEqual(facts.map(f => f.id), ['gpt-6.1-sol'])
})

process.stdout.write('\nsetting validation\n')

await check('semver shapes are accepted', async () => {
  for (const value of ['1.0.0', '0.159.0', '0.1.7-rc.2']) {
    assert.ok(isSemverLike(value), `${value} should be accepted`)
  }
})

await check('the value upstream rejects is rejected here too', async () => {
  // `latest` answers 400 Invalid client_version format, which would surface as
  // an inexplicably empty catalog rather than a bad setting.
  for (const value of ['latest', 'v1.0.0', '1.0', '', 'not-a-version']) {
    assert.ok(!isSemverLike(value), `${value} should be rejected`)
  }
})

process.stdout.write(`\nall ${passed} live Codex model checks passed\n`)
