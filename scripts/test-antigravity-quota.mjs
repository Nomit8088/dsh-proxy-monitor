/**
 * Antigravity quota/catalog failure separation and monitor route authority.
 *
 * Every upstream reply here is a synthetic fixture. Never reads user OAuth
 * documents, never calls Google, and restores the process fetch stub afterward.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchAccountQuota, FileModelSettingsStore, AntigravityAdapter, parseCatalogModels } from '../lib/antigravity/index.js'
import { readAntigravity } from '../lib/providers/antigravity.js'

const originalFetch = globalThis.fetch
const fakeStore = { read: async () => ({ access: 'fixture-access', expires: Date.now() + 3600_000, projectId: 'fixture-project' }) }
const quotaBody = { groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'weekly', window: 'weekly', remainingFraction: 0.45 }] }] }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let count = 0
const check = async (label, fn) => { await fn(); process.stdout.write(`  ok   ${label}\n`); count++ }
try {
  await check('quota remains readable if all available-models endpoints return 403', async () => {
    let writes = 0
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.includes('loadCodeAssist')) return json({ projectId: 'fixture-project' })
      if (path.includes('retrieveUserQuotaSummary')) return json(quotaBody)
      if (path.includes('fetchAvailableModels')) return json({ error: { message: 'Verify your account to continue.' } }, 403)
      throw new Error(`unexpected fixture route ${path}`)
    }
    const result = await fetchAccountQuota(fakeStore, {
      read: async () => ({ enabledModelIds: ['gemini-3.7-flash'], catalogModels: [{ id: 'gemini-3.7-flash' }] }),
      setCatalogModels: async () => { writes++ },
    })
    assert.equal(result.groups[0].buckets[0].remainingFraction, 0.45)
    assert.match(result.catalogError, /model discovery failed.*HTTP 403.*Verify your account/i)
    assert.deepEqual(result.catalogModels, [])
    assert.equal(writes, 0, 'failed discovery must not overwrite the last saved catalog')
  })

  await check('empty 200 plus 403 is incomplete, not an authoritative empty catalog', async () => {
    let writes = 0
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.includes('loadCodeAssist')) return json({ projectId: 'fixture-project' })
      if (path.includes('retrieveUserQuotaSummary')) return json(quotaBody)
      if (path.includes('fetchAvailableModels')) return path.includes('sandbox')
        ? json({ models: {} })
        : json({ error: { message: 'Verify your account to continue.' } }, 403)
      throw new Error(`unexpected fixture route ${path}`)
    }
    const result = await fetchAccountQuota(fakeStore, {
      read: async () => ({ enabledModelIds: ['gemini-3.7-flash'], catalogModels: [{ id: 'gemini-3.7-flash' }] }),
      setCatalogModels: async () => { writes++ },
    })
    assert.equal(result.groups[0].buckets[0].remainingFraction, 0.45)
    assert.match(result.catalogError, /model discovery incomplete.*HTTP 403/i)
    assert.equal(writes, 0)
  })

  await check('daily production host alone can serve quota and live Gemini 3.8 catalog', async () => {
    const hosts = new Set()
    globalThis.fetch = async url => {
      const path = String(url)
      const host = new URL(path).host
      hosts.add(host)
      if (host === 'daily-cloudcode-pa.googleapis.com') {
        if (path.includes('loadCodeAssist')) return json({ projectId: 'fixture-project' })
        if (path.includes('retrieveUserQuotaSummary')) return json(quotaBody)
        if (path.includes('fetchAvailableModels')) return json({ models: {
          'gemini-3.8-flash-tiered': { displayName: 'Gemini 3.8 Flash', quotaInfo: { remainingFraction: 0.8 } },
        } })
      }
      return json({ error: { message: 'Verify your account to continue.' } }, 403)
    }
    const result = await fetchAccountQuota(fakeStore)
    assert.equal(result.endpoint, 'https://daily-cloudcode-pa.googleapis.com')
    assert.equal(result.groups[0].buckets[0].remainingFraction, 0.45)
    assert.equal(result.models[0].modelId, 'gemini-3.8-flash-tiered')
    assert.equal(result.models[0].remainingFraction, 0.8)
    assert.equal(result.catalogError, undefined)
    assert.ok(hosts.has('daily-cloudcode-pa.googleapis.com'))
  })

  await check('daily production quota takes precedence over a conflicting sandbox response', async () => {
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.includes('loadCodeAssist')) return json({ projectId: 'fixture-project' })
      if (path.includes('retrieveUserQuotaSummary')) return json({ groups: [{
        displayName: 'Gemini', buckets: [{ bucketId: 'weekly', window: 'weekly', remainingFraction:
          new URL(path).host === 'daily-cloudcode-pa.googleapis.com' ? 0.8 : 0.2 }],
      }] })
      if (path.includes('fetchAvailableModels')) return json({ models: {
        'gemini-3.8-flash-tiered': { quotaInfo: { remainingFraction:
          new URL(path).host === 'daily-cloudcode-pa.googleapis.com' ? 0.8 : 0.2 } },
      } })
      throw new Error(`unexpected fixture route ${path}`)
    }
    const result = await fetchAccountQuota(fakeStore)
    assert.equal(result.groups[0].buckets[0].remainingFraction, 0.8)
    assert.equal(result.models[0].remainingFraction, 0.8)
    assert.equal(result.endpoint, 'https://daily-cloudcode-pa.googleapis.com')
  })

  await check('catalog per-model quota remains readable if summary is denied everywhere', async () => {
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.includes('loadCodeAssist')) return json({ projectId: 'fixture-project' })
      if (path.includes('retrieveUserQuotaSummary')) return json({ error: { message: 'Verify your account to continue.' } }, 403)
      if (path.includes('fetchAvailableModels')) return json({ models: {
        'gemini-3.8-flash-tiered': { quotaInfo: { remainingFraction: 0.63 } },
      } })
      throw new Error(`unexpected fixture route ${path}`)
    }
    const result = await fetchAccountQuota(fakeStore)
    assert.deepEqual(result.groups, [])
    assert.match(result.quotaError, /quota summary failed.*HTTP 403/i)
    assert.equal(result.models[0].remainingFraction, 0.63)
    assert.equal(result.catalogModels[0].id, 'gemini-3.8-flash-tiered')
  })

  await check('all quota endpoints denied keep their status and account-verification reason', async () => {
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.includes('loadCodeAssist')) return json({ projectId: 'fixture-project' })
      if (path.includes('retrieveUserQuotaSummary') || path.includes('fetchAvailableModels')) {
        return json({ error: { message: 'Verify your account to continue.' } }, 403)
      }
      throw new Error(`unexpected fixture route ${path}`)
    }
    await assert.rejects(fetchAccountQuota(fakeStore), /quota summary failed.*HTTP 403.*Verify your account/i)
  })

  await check('an actually returned Gemini 3.8 Flash passes through without a guessed alias', async () => {
    const id = 'gemini-3.8-flash-tiered'
    const catalog = parseCatalogModels({ models: { [id]: { displayName: 'Gemini 3.8 Flash', supportsImages: true } } })
    assert.equal(catalog.length, 1)
    assert.equal(catalog[0].id, id)
    assert.equal(catalog[0].name, 'Gemini 3.8 Flash')
  })

  await check('no successful live catalog and authoritative empty catalog advertise no static 3.7', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-antigravity-empty-'))
    try {
      const file = join(root, 'antigravity-settings.json')
      const settings = new FileModelSettingsStore(file)
      const adapter = new AntigravityAdapter(fakeStore, settings)
      assert.deepEqual(await adapter.listModels('antigravity'), [], 'no saved catalog')
      await settings.setCatalogModels([], { enabledModelIds: [] })
      assert.deepEqual(await adapter.listModels('antigravity'), [], 'successful empty catalog')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  await check('monitor uses actual per-model remainder without fabricating weekly buckets', async () => {
    globalThis.fetch = async () => json({ ok: true, value: {
      quotaError: 'summary HTTP 403', bucketRows: [],
      modelRows: [{ id: 'gemini-3.8-flash-tiered', label: 'Gemini 3.8 Flash', remainingFraction: 0.63 }],
    } })
    const result = await readAntigravity({ home: tmpdir(), warn: () => {}, credential: async () => undefined }, 'http://127.0.0.1:3199')
    assert.equal(result.status, 'ok')
    assert.equal(result.windows.length, 1)
    assert.equal(result.windows[0].kind, 'other')
    assert.equal(result.windows[0].usedPercent, 37)
    assert.match(result.windows[0].detail, /分组的 5 小时\/每周额度未读取/)
  })

  await check('missing both summary buckets and per-model fractions reports summary error', async () => {
    globalThis.fetch = async () => json({ ok: true, value: {
      quotaError: 'summary HTTP 403', bucketRows: [], modelRows: [{ id: 'gemini-3.8-flash-tiered' }],
    } })
    const result = await readAntigravity({ home: tmpdir(), warn: () => {}, credential: async () => undefined }, 'http://127.0.0.1:3199')
    assert.equal(result.status, 'error')
    assert.match(result.error, /summary HTTP 403/)
  })

  await check('local quota route 500 is authoritative and does not retry with raw token', async () => {
    let calls = 0
    globalThis.fetch = async () => { calls++; return json({ ok: false, error: 'quota summary failed: HTTP 403 (Verify your account to continue.)' }, 500) }
    const result = await readAntigravity({ home: tmpdir(), warn: () => {}, credential: async () => undefined }, 'http://127.0.0.1:3199')
    assert.equal(calls, 1)
    assert.equal(result.status, 'error')
    assert.match(result.error, /quota summary failed.*HTTP 403/i)
  })

  await check('only absent local quota route uses the direct fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-antigravity-fallback-'))
    try {
      await mkdir(join(root, 'storages'))
      await writeFile(join(root, 'storages', 'antigravity-oauth.json'), JSON.stringify({ access: 'fixture-access' }))
      let calls = 0
      globalThis.fetch = async url => {
        calls++
        if (String(url).includes('/antigravity/api/quota')) return new Response('not found', { status: 404 })
        if (String(url).includes('retrieveUserQuotaSummary')) return json(quotaBody)
        throw new Error(`unexpected fixture route ${String(url)}`)
      }
      const result = await readAntigravity({ home: root, warn: () => {}, credential: async () => undefined }, 'http://127.0.0.1:3199')
      assert.equal(calls, 2)
      assert.equal(result.status, 'ok')
      assert.equal(result.windows.length, 1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
} finally { globalThis.fetch = originalFetch }
process.stdout.write(`\nall ${count} Antigravity quota checks passed\n`)
