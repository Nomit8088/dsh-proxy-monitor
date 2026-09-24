/**
 * Unit tests for the Antigravity live model catalog and image-support override.
 *
 * Verifies:
 * - live payload is the source of truth (hardcoded families not in the payload
 *   are not injected)
 * - unmatched live models (new releases) appear
 * - enable/disable merge keeps user choices and auto-enables new ids
 * - image-support merge keeps user overrides and infers defaults for new ids
 * - selected image models declare `inputModalities: image` so DSH will not
 *   intercept attachments
 *
 * Run with:  node scripts/test-antigravity-models.mjs
 */

import assert from 'node:assert/strict'
import {
  parseCatalogModels,
  defaultImageModelIdsFrom,
  withUserImageSupport,
  mergeEnabledModelIds,
  mergeImageModelIds,
  imageModelIdsOf,
} from '../lib/antigravity/index.js'

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

const LIVE_PAYLOAD = {
  models: {
    'gemini-3.7-flash-tiered': {
      displayName: 'Gemini 3.7 Flash',
      supportsImages: true,
      quotaInfo: { remainingFraction: 0.8 },
    },
    'claude-sonnet-4-6-thinking': {
      displayName: 'Claude Sonnet 4.6',
      supportsImages: true,
    },
    'gemini-4-ultra': {
      displayName: 'Gemini 4 Ultra',
      supportsImages: true,
    },
    'gpt-oss-120b-medium': {
      displayName: 'GPT-OSS 120B',
      supportsImages: false,
    },
  },
}

process.stdout.write('\nantigravity live catalog\n')

await check('parseCatalogModels omits hardcoded families missing from the live payload', async () => {
  const catalog = parseCatalogModels(LIVE_PAYLOAD)
  const ids = catalog.map((model) => model.id)
  assert.equal(ids.includes('gemini-2.5-pro'), false)
  assert.equal(ids.includes('gemini-3.1-pro'), false)
  assert.equal(ids.includes('gemini-3.5-flash'), false)
})

await check('parseCatalogModels consolidates known families onto public ids', async () => {
  const catalog = parseCatalogModels(LIVE_PAYLOAD)
  const ids = catalog.map((model) => model.id)
  assert.equal(ids.includes('gemini-3.7-flash'), true)
  assert.equal(ids.includes('claude-sonnet-4-6'), true)
  assert.equal(ids.includes('gpt-oss-120b'), true)
  assert.equal(ids.includes('gemini-3.7-flash-tiered'), false)
})

await check('parseCatalogModels appends unmatched live models', async () => {
  const catalog = parseCatalogModels(LIVE_PAYLOAD)
  const ultra = catalog.find((model) => model.id === 'gemini-4-ultra')
  assert.ok(ultra)
  assert.equal(ultra.name, 'Gemini 4 Ultra')
  assert.deepEqual(ultra.inputModalities, ['text', 'image'])
})

await check('empty live payload yields an empty catalog (fallback is the caller\'s job)', async () => {
  assert.deepEqual(parseCatalogModels({ models: {} }), [])
  assert.deepEqual(parseCatalogModels({}), [])
})

process.stdout.write('\nantigravity enable/disable merge\n')

await check('first fetch enables every live model', async () => {
  const catalog = parseCatalogModels(LIVE_PAYLOAD)
  const enabled = mergeEnabledModelIds({ catalogModels: [], enabledModelIds: [] }, catalog)
  assert.deepEqual(enabled.sort(), catalog.map((model) => model.id).sort())
})

await check('later fetch keeps user disables and auto-enables newly discovered ids', async () => {
  const previous = [
    { id: 'gemini-3.7-flash' },
    { id: 'claude-sonnet-4-6' },
  ]
  const next = [
    { id: 'gemini-3.7-flash' },
    { id: 'claude-sonnet-4-6' },
    { id: 'gemini-4-ultra' },
  ]
  const enabled = mergeEnabledModelIds(
    { catalogModels: previous, enabledModelIds: ['claude-sonnet-4-6'] },
    next,
  )
  assert.equal(enabled.includes('gemini-3.7-flash'), false)
  assert.equal(enabled.includes('claude-sonnet-4-6'), true)
  assert.equal(enabled.includes('gemini-4-ultra'), true)
})

await check('later fetch drops ids that left the live catalog', async () => {
  const enabled = mergeEnabledModelIds(
    {
      catalogModels: [{ id: 'gemini-3.7-flash' }, { id: 'gone-model' }],
      enabledModelIds: ['gemini-3.7-flash', 'gone-model'],
    },
    [{ id: 'gemini-3.7-flash' }],
  )
  assert.deepEqual(enabled, ['gemini-3.7-flash'])
})

process.stdout.write('\nantigravity image-support merge\n')

await check('first fetch infers image support from catalog modalities', async () => {
  const catalog = [
    { id: 'gemini-3.7-flash', inputModalities: ['text', 'image'] },
    { id: 'gpt-oss-120b', inputModalities: ['text'] },
  ]
  const imageIds = mergeImageModelIds({ catalogModels: [] }, catalog)
  assert.deepEqual(imageIds, ['gemini-3.7-flash'])
})

await check('later fetch keeps a user image override and infers for new models', async () => {
  const imageIds = mergeImageModelIds(
    {
      catalogModels: [
        { id: 'gemini-3.7-flash', inputModalities: ['text', 'image'] },
        { id: 'gpt-oss-120b', inputModalities: ['text'] },
      ],
      imageModelIds: ['gpt-oss-120b'],
    },
    [
      { id: 'gemini-3.7-flash', inputModalities: ['text', 'image'] },
      { id: 'gpt-oss-120b', inputModalities: ['text'] },
      { id: 'gemini-4-ultra', inputModalities: ['text', 'image'] },
    ],
  )
  assert.equal(imageIds.includes('gemini-3.7-flash'), false)
  assert.equal(imageIds.includes('gpt-oss-120b'), true)
  assert.equal(imageIds.includes('gemini-4-ultra'), true)
})

await check('withUserImageSupport declares image input so DSH will not intercept', async () => {
  const selected = withUserImageSupport({ id: 'gpt-oss-120b', inputModalities: ['text'] }, ['gpt-oss-120b'])
  assert.deepEqual(selected.inputModalities, ['text', 'image'])
  assert.equal(selected.inputModalities.includes('image'), true)
})

await check('withUserImageSupport strips image input when the user turned it off', async () => {
  const stripped = withUserImageSupport(
    { id: 'gemini-3.7-flash', inputModalities: ['text', 'image'] },
    new Set(),
  )
  assert.deepEqual(stripped.inputModalities, ['text'])
  assert.equal(stripped.inputModalities.includes('image'), false)
})

await check('imageModelIdsOf infers from catalog when the override field is missing', async () => {
  const ids = imageModelIdsOf({
    enabledModelIds: ['gemini-3.7-flash', 'gpt-oss-120b'],
    catalogModels: [
      { id: 'gemini-3.7-flash', inputModalities: ['text', 'image'] },
      { id: 'gpt-oss-120b', inputModalities: ['text'] },
    ],
  })
  assert.deepEqual(ids, ['gemini-3.7-flash'])
})

await check('imageModelIdsOf honours an explicit empty override', async () => {
  const ids = imageModelIdsOf({
    enabledModelIds: ['gemini-3.7-flash'],
    imageModelIds: [],
    catalogModels: [
      { id: 'gemini-3.7-flash', inputModalities: ['text', 'image'] },
    ],
  })
  assert.deepEqual(ids, [])
})

await check('defaultImageModelIdsFrom reads inferred catalog flags', async () => {
  assert.deepEqual(
    defaultImageModelIdsFrom([
      { id: 'a', inputModalities: ['text', 'image'] },
      { id: 'b', inputModalities: ['text'] },
    ]),
    ['a'],
  )
})

process.stdout.write(`\nall ${String(passed)} antigravity model checks passed\n`)
