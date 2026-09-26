/**
 * Link the DSH type surfaces this plugin compiles against into node_modules.
 *
 * The plugin ships as a bundle and resolves these packages from the DSH
 * installation at runtime, so they are NOT real dependencies and must never be
 * listed in package.json `dependencies` (that would pin a second copy). They
 * are needed only to typecheck and to emit declarations.
 *
 * These are junctions (directory symlinks), not copies, so the types always
 * track the installed harness and cannot drift.
 *
 * Run with:  node scripts/link-types.mjs
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/**
 * Locate the installed DSH package root.
 *
 * The harness is an ordinary npm package, so its own node_modules holds every
 * runtime surface; `dsh/bin.js` is the entry the global shim invokes.
 * @returns absolute path of the `@deepseek-ai/dsh` package directory.
 */
function locateHarness() {
  const candidates = [
    process.env.DSH_CHECKOUT,
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh'),
    join(process.env.LOCALAPPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh'),
  ].filter(candidate => candidate !== '')
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(join(candidate, 'package.json'))) return candidate
  }
  // Fall back to resolving the shim's target from this process's own tree.
  try {
    return dirname(require.resolve('@deepseek-ai/dsh/package.json'))
  } catch {
    return undefined
  }
}

const HARNESS = locateHarness()
if (HARNESS === undefined) {
  console.error('link-types: cannot locate the DSH installation (set DSH_CHECKOUT)')
  process.exit(1)
}

/** Where the harness keeps its own dependencies. */
const HARNESS_MODULES = join(HARNESS, 'node_modules')

/**
 * Additional module roots, searched in order when a package is not in the
 * harness tree. The Web profile hoists client-side packages into its own
 * node_modules (and a `.dsh-module-fallback` seat), so a browser-facing type
 * surface usually lives there rather than beside the host packages.
 */
const FALLBACK_MODULES = [
  join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh'), 'profiles', 'web', 'node_modules'),
  join(
    process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh'),
    'profiles',
    'web',
    '.dsh-module-fallback',
    'node_modules',
  ),
]

/**
 * Resolve one package's directory across the harness tree and the profile
 * module roots.
 * @param name - package name, e.g. `@deepseek-ai/dsh-client-ui-slots`.
 * @returns the absolute directory, or undefined when no root carries it.
 */
function locatePackage(name) {
  const roots = [HARNESS_MODULES, ...FALLBACK_MODULES]
  for (const root of roots) {
    const candidate = join(root, ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Package names the host half and client half compile against.
 *
 * The first block is what the quota monitor itself needs; the second block is
 * the LLM/provider surface the merged reverse-proxy adapters compile against
 * (codex / antigravity / workbuddy / grok). All of them are resolved from the
 * installed harness or the Web profile at runtime, so they are junctions —
 * never real dependencies.
 */
const PACKAGES = [
  // Quota monitor (original surface).
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-settings',
  // 0.1.7 surfaces: the browser store the Codex composer rows take their model
  // directory from, the Loader's `loader/volatile-update` event this plugin
  // listens to, and the settings client's path-op contract.
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/dsh-api-remotes',
  // LLM / provider surface for the merged reverse-proxy adapters.
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-web',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-host-webserver',
  // Client surfaces the merged browser half registers into.
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-tool',
  '@earendil-works/pi-ai',
]

mkdirSync(join(ROOT, 'node_modules', '@deepseek-ai'), { recursive: true })

let linked = 0
for (const name of PACKAGES) {
  const target = locatePackage(name)
  if (target === undefined) {
    console.warn(`link-types: skipping ${name} (not found in any module root)`)
    continue
  }
  const link = join(ROOT, 'node_modules', ...name.split('/'))
  rmSync(link, { recursive: true, force: true })
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  linked += 1
}

// schemastery is imported as a bare specifier by the host half; npm installed a
// real copy at the top level, which the junction above shadows for @deepseek-ai.
process.stdout.write(`link-types: ${String(linked)} type links created from ${HARNESS}\n`)
