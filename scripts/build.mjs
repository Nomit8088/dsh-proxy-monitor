/**
 * Build @dsh-external/dsh-proxy-monitor — self-contained, no DSH source
 * checkout required.
 *
 *   1. `tsc`     compiles the host half  src/**  ->  lib/**  (+ lib/types)
 *   2. `tsdown`  bundles the browser half src/client/** -> lib/client.js
 *                (the window.__ModuleLoader__.load artifact the shell loads)
 *
 * Run with:  node scripts/build.mjs
 *
 * The npm cache is pinned inside the repository so the build never needs write
 * access outside the workspace; override with DSH_PROXY_MONITOR_CACHE.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Resolve a package's bin script without relying on shell shims (.cmd/.ps1). */
function binScript(pkg, relative) {
  return join(ROOT, 'node_modules', pkg, relative)
}

const TSC = binScript('typescript', 'bin/tsc')
const TSDOWN = binScript('tsdown', 'dist/run.mjs')

/** Run one build step with inherited stdio; a non-zero exit aborts the build. */
function run(label, script, args) {
  process.stdout.write(`\n=== ${label} ===\n`)
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_cache: process.env.DSH_PROXY_MONITOR_CACHE ?? join(ROOT, '.npm-cache'),
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status)}`)
  }
}

/** Remove a path when present; build outputs must never accumulate stale files. */
function clean(relative) {
  rmSync(join(ROOT, relative), { recursive: true, force: true })
}

if (!existsSync(TSC)) {
  console.error('build: typescript is not installed — run `npm install` first')
  process.exit(1)
}
if (!existsSync(TSDOWN)) {
  console.error('build: tsdown is not installed — run `npm install` first')
  process.exit(1)
}

// The DSH type surfaces resolve through junctions into the installed harness;
// re-create them so a fresh clone builds without a manual step.
run('Linking build dependencies', join(ROOT, 'scripts', 'link-types.mjs'), [])

// lib/types is emitted by tsc and must survive the tsdown pass (clean: false),
// so only the bundle artifacts and previous declarations are cleared here.
clean('lib/client.js')
clean('lib/client.js.map')
clean('lib/types')

run('Compiling host (tsc)', TSC, ['-p', 'tsconfig.json'])

// Antigravity & Workbuddy source files are plain JS without a build step; ensure their files are present in lib/
const copyPlainJs = (sub) => {
  const src = join(ROOT, 'src', sub)
  const dest = join(ROOT, 'lib', sub)
  if (existsSync(src)) {
    mkdirSync(dest, { recursive: true })
    for (const f of ['index.js', 'variants-CExA7lJt.js', 'bin.js']) {
      const srcFile = join(src, f)
      if (existsSync(srcFile)) copyFileSync(srcFile, join(dest, f))
    }
  }
}
copyPlainJs('antigravity')
copyPlainJs('workbuddy')

run('Typechecking client (tsc)', TSC, ['-p', 'tsconfig.client.json'])
run('Testing rail geometry', join(ROOT, 'scripts', 'test-frame.mjs'), [])
run('Testing panel transition', join(ROOT, 'scripts', 'test-transition.mjs'), [])
run('Testing account face', join(ROOT, 'scripts', 'test-accounts.mjs'), [])
run('Testing grok account', join(ROOT, 'scripts', 'test-grok-account.mjs'), [])
run('Testing codex account', join(ROOT, 'scripts', 'test-codex-account.mjs'), [])
run('Testing antigravity account', join(ROOT, 'scripts', 'test-antigravity-account.mjs'), [])
run('Testing antigravity models', join(ROOT, 'scripts', 'test-antigravity-models.mjs'), [])
run('Testing catalog preferences', join(ROOT, 'scripts', 'test-catalog-preferences.mjs'), [])
run('Testing workbuddy encrypted auth', join(ROOT, 'scripts', 'test-workbuddy-encrypted-auth.mjs'), [])
run('Verifying rail silhouette', join(ROOT, 'scripts', 'preview-shape.mjs'), [])
run('Bundling client (tsdown)', TSDOWN, ['-c', 'tsdown.config.ts'])
run('Inspecting bundle CSS', join(ROOT, 'scripts', 'inspect-css.mjs'), [])

process.stdout.write('\n=== Build complete ===\n')
