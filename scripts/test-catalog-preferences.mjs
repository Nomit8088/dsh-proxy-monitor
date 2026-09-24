/**
 * Shared catalog enable / image-support merge, plus Codex image overlay.
 *
 * Run with:  node scripts/test-catalog-preferences.mjs
 */

import assert from 'node:assert/strict'
import {
  defaultImageModelIdsFrom,
  mergeEnabledModelIds,
  mergeImageModelIds,
  withUserImageSupport,
} from '../lib/catalog/preferences.js'
import { withOpenAICodexImageModalities } from '../lib/codex/adapter.js'
import {
  mergeLiveCodexModels,
  parseLiveCodexModels,
  templateForLiveCodexModel,
} from '../lib/codex/live-models.js'

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

process.stdout.write('\nshared catalog preferences\n')

await check('withUserImageSupport declares image input so DSH will not intercept', async () => {
  const selected = withUserImageSupport({ id: 'spark', input: ['text'] }, ['spark'])
  assert.deepEqual(selected.inputModalities, ['text', 'image'])
})

await check('mergeEnabledModelIds auto-enables newly discovered ids', async () => {
  const enabled = mergeEnabledModelIds(
    { catalogModels: [{ id: 'a' }], enabledModelIds: ['a'] },
    [{ id: 'a' }, { id: 'b' }],
  )
  assert.deepEqual(enabled.sort(), ['a', 'b'])
})

await check('mergeImageModelIds keeps a user override', async () => {
  const imageIds = mergeImageModelIds(
    {
      catalogModels: [{ id: 'a', supportsImages: true }, { id: 'b', supportsImages: false }],
      imageModelIds: ['b'],
    },
    [
      { id: 'a', supportsImages: true },
      { id: 'b', supportsImages: false },
      { id: 'c', supportsImages: true },
    ],
  )
  assert.equal(imageIds.includes('a'), false)
  assert.equal(imageIds.includes('b'), true)
  assert.equal(imageIds.includes('c'), true)
})

await check('defaultImageModelIdsFrom reads supportsImages and input', async () => {
  assert.deepEqual(
    defaultImageModelIdsFrom([
      { id: 'a', supportsImages: true },
      { id: 'b', input: ['text'] },
      { id: 'c', inputModalities: ['text', 'image'] },
    ]).sort(),
    ['a', 'c'],
  )
})

process.stdout.write('\ncodex image overlay\n')

await check('withOpenAICodexImageModalities overlays model.input', async () => {
  const provider = {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    getModels: () => [
      { id: 'gpt-5.4', input: ['text', 'image'] },
      { id: 'gpt-5.3-codex-spark', input: ['text'] },
    ],
  }
  const overlaid = withOpenAICodexImageModalities(provider, () => ['gpt-5.3-codex-spark'])
  const models = overlaid.getModels()
  assert.deepEqual(models.find((model) => model.id === 'gpt-5.3-codex-spark').input, ['text', 'image'])
  assert.deepEqual(models.find((model) => model.id === 'gpt-5.4').input, ['text'])
})

process.stdout.write('\nlive Codex catalog\n')

await check('parseLiveCodexModels reads slug and display_name', async () => {
  const facts = parseLiveCodexModels({
    models: [
      { slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', context_window: 1050000 },
      { slug: 'gpt-6-sol', display_name: 'GPT-6 Sol' },
    ],
  })
  assert.deepEqual(facts.map((fact) => fact.id).sort(), ['gpt-6-luna', 'gpt-6-sol'])
  assert.equal(facts.find((fact) => fact.id === 'gpt-6-luna').name, 'GPT-6 Luna')
  assert.equal(facts.find((fact) => fact.id === 'gpt-6-luna').contextWindow, 1050000)
})

await check('mergeLiveCodexModels synthesizes missing gpt-6 models onto a template', async () => {
  const base = [
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', input: ['text', 'image'], contextWindow: 272000 },
  ]
  const merged = mergeLiveCodexModels(base, [
    { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 1050000 },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  ])
  assert.equal(merged.some((model) => model.id === 'gpt-5.6-sol'), true)
  const sol = merged.find((model) => model.id === 'gpt-6-sol')
  assert.ok(sol)
  assert.equal(sol.name, 'GPT-6 Sol')
  assert.equal(sol.contextWindow, 1050000)
  assert.deepEqual(sol.input, ['text', 'image'])
})

await check('templateForLiveCodexModel prefers the same family', async () => {
  const base = [
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  ]
  assert.equal(templateForLiveCodexModel(base, 'gpt-6-luna').id, 'gpt-5.6-luna')
  assert.equal(templateForLiveCodexModel(base, 'gpt-6-sol').id, 'gpt-5.6-sol')
})

process.stdout.write(`\nall ${String(passed)} catalog preference checks passed\n`)
