/**
 * WorkBuddy model catalog: one preferences file, one truth.
 *
 * The report this guards: "I enabled a WorkBuddy model in the settings page and
 * the composer's model picker never showed it." Two independent mechanisms made
 * that possible, and neither is visible from the settings page:
 *
 * 1. the operator's panel and the adapter's `listModels` filter named *different*
 *    files, so a selection landed in one and the picker filtered by the other;
 * 2. the vendored runtime cached its read for the lifetime of the module, so a
 *    write performed by any other generation of the plugin stayed invisible.
 *
 * Run with: node scripts/test-workbuddy-catalog.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
function check(label, condition) {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failed += 1
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The overlay resolves the DSH home per call, so pointing DSH_HOME at a
// scratch directory is enough to exercise the real read path.
const HOME = mkdtempSync(join(tmpdir(), 'dsh-proxy-monitor-catalog-'))
process.env.DSH_HOME = HOME

const { WORKBUDDY_PREFS_FILENAME, overlayWorkBuddyAdapterModels } = await import('../lib/catalog-http.js')

/** Write the preferences document the settings page writes. */
function writePrefs(next) {
  const path = join(HOME, WORKBUDDY_PREFS_FILENAME)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ catalogModels: [], updatedAt: Date.now(), ...next }, null, 2))
}

const MODELS = [
  { id: 'alpha', name: 'Alpha', inputModalities: ['text', 'image'] },
  { id: 'beta', name: 'Beta' },
  { id: 'gamma', name: 'Gamma' },
]

const ids = models => models.map(model => model.id)
const modalities = (models, id) => models.find(model => model.id === id)?.inputModalities ?? []

console.log('\ncatalog preferences (single source)')
check('the preferences file is the one the vendored runtime reads', WORKBUDDY_PREFS_FILENAME === '.workbuddy-user-catalog.json')

const untouched = await overlayWorkBuddyAdapterModels(MODELS)
check('with no preferences every model stays visible', ids(untouched).join() === 'alpha,beta,gamma')
check('an image-capable model keeps image input', modalities(untouched, 'alpha').includes('image'))
check('a text-only model declares text only', modalities(untouched, 'beta').join() === 'text')

writePrefs({ enabledModelIds: ['beta'], imageModelIds: ['beta'] })
const filtered = await overlayWorkBuddyAdapterModels(MODELS)
check('a disabled model leaves the picker', ids(filtered).join() === 'beta')
check('the enabled model carries the image flag', modalities(filtered, 'beta').includes('image'))

// The regression: a second write must be seen by a second read. The vendored
// runtime used to answer this from a cache populated at module load.
writePrefs({ enabledModelIds: ['gamma'], imageModelIds: [] })
const rewritten = await overlayWorkBuddyAdapterModels(MODELS)
check('a later write replaces the previous selection', ids(rewritten).join() === 'gamma')
check('an image flag turned off is honoured', modalities(rewritten, 'gamma').join() === 'text')

writePrefs({ enabledModelIds: ['alpha', 'beta', 'gamma'], imageModelIds: ['beta'] })
const restored = await overlayWorkBuddyAdapterModels(MODELS)
check('re-enabling is symmetric', ids(restored).join() === 'alpha,beta,gamma')
check('image flags are per model', modalities(restored, 'beta').includes('image') && !modalities(restored, 'alpha').includes('image'))

// The two writers must not drift apart again: the vendored constant is plain
// JS we cannot import here (it pulls platform packages at module load), so the
// contract is asserted against its source text.
console.log('\ncontract with the vendored runtime')
const vendored = readFileSync(join(ROOT, 'src', 'workbuddy', 'index.js'), 'utf8')
check(
  'the vendored filename constant matches the plugin constant',
  vendored.includes(`const WORKBUDDY_USER_CATALOG_FILENAME = "${WORKBUDDY_PREFS_FILENAME}"`),
)
check('the vendored reader holds no process-lifetime cache', !vendored.includes('userCatalogCache'))
check(
  'the replaced second preferences file is gone from the plugin',
  !readFileSync(join(ROOT, 'src', 'catalog-http.ts'), 'utf8').includes('workbuddy-model-settings.json'),
)

rmSync(HOME, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\n${String(failed)} workbuddy catalog check(s) failed`)
  process.exit(1)
}
console.log('\nworkbuddy catalog single-source checks passed')
