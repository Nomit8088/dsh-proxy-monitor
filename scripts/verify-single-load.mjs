#!/usr/bin/env node
/**
 * Startup duplicate-load verifier (regression guard for the
 * duplicate-mount boot crash).
 *
 * Replays the profile composition the way `dsh web` does, WITHOUT booting a
 * server: profile `dsh.profile.bundles` -> each bundle's `dsh.bundle.patch` ->
 * profile `cordis.patch.yml` overlay. Then it counts how many loader rows name
 * the plugin, and cross-checks the super-injector registry that would inject it
 * a second time at runtime.
 *
 * Two independent paths load a plugin: the static bundle layer and the
 * injector's persisted registry. A package present on BOTH paths mounts twice,
 * and the second mount re-registers everything the plugin owns — LLM adapters,
 * the Connection RPC channel, the configurable-provider directory — which those
 * registries refuse, failing the whole plugin tree. This script asserts the two
 * paths stay disjoint.
 *
 * Usage: node scripts/verify-single-load.mjs [--profile <name>] [--plugin <pkg>]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const argOf = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)

const profileName = argOf('--profile', 'web')
const plugin = argOf('--plugin', '@dsh-external/dsh-proxy-monitor')

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(home, 'profiles', profileName)
const profilePkgPath = join(profileDir, 'package.json')

const problems = []
const notes = []

/** Read JSON, returning undefined instead of throwing (absence is meaningful here). */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

const profilePkg = readJson(profilePkgPath)
if (profilePkg === undefined) {
  // This check inspects one machine's installed DSH profile, which a fresh
  // clone or a CI box does not have. Absence is not a failure of this repo.
  console.log(`SKIP  : no readable profile at ${profilePkgPath} — single-load check needs an installed profile`)
  process.exit(0)
}

/**
 * Roots a bundle can resolve from. Profile-local packages (third-party and
 * `link:`-ed plugins) live under the profile's node_modules; the platform's own
 * bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`) ship inside the
 * harness installation instead and are absent from the profile tree.
 */
function bundleRoots() {
  const roots = [join(profileDir, 'node_modules')]
  const npmGlobal = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : undefined
  if (npmGlobal) roots.push(join(npmGlobal, '@deepseek-ai', 'dsh', 'node_modules'))
  return roots
}

/**
 * Resolve a bundle name to its package.json on disk, trying the profile tree
 * first and the harness installation second.
 */
function bundlePackageJson(name) {
  const parts = name.startsWith('@') ? name.split('/') : [name]
  for (const root of bundleRoots()) {
    const pkgPath = join(root, ...parts, 'package.json')
    const pkg = readJson(pkgPath)
    if (pkg !== undefined) return { pkgPath, pkg }
  }
  return { pkgPath: join(bundleRoots()[0], ...parts, 'package.json'), pkg: undefined }
}

/**
 * Count the loader rows naming `plugin` across the whole composition. A row is
 * an entry in a patch file's `insert` list; the plugin's own bundle patch is the
 * usual contributor, and a hand-written row in the profile patch layer is the
 * other. Duplicate *insert* rows with the same id are also a hard boot failure
 * ("duplicate loader entry id"), so ids are tracked too.
 *
 * Only rows inside an `insert:` list mount an entry. A top-level `- id:` row is
 * an id-targeted override — the shape the settings seam writes when a user edits
 * an entry's configuration (`- id: dsh-proxy-monitor` + `config:`) — and such a
 * row naming the same plugin must not be mistaken for a second mount: it merges
 * into the row the bundle already inserted. The scanner therefore tracks which
 * enclosing block a row belongs to.
 */
const rows = []
const patchFiles = []

function collectPatch(patchPath, origin) {
  if (!existsSync(patchPath)) return
  const text = readFileSync(patchPath, 'utf8')
  patchFiles.push(`${origin}: ${patchPath}`)
  // Minimal YAML: only the `- id: <x>` / `name: <y>` pairs matter here, plus the
  // `insert:` block each row belongs to.
  let current = null
  let insertIndent
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    const insertKeyAt = line.indexOf('insert:')
    if (insertKeyAt >= 0 && /^\s*(?:-\s*)?insert:\s*$/.test(line)) {
      // Children of an `insert:` list sit deeper than its key, which may itself
      // be a list item (`- insert:`), so the key column is what matters.
      insertIndent = insertKeyAt
      continue
    }
    const keyMatch = /^\s*([A-Za-z_][\w-]*):/.exec(line)
    if (keyMatch && insertIndent !== undefined && indent <= insertIndent) insertIndent = undefined
    const idMatch = /^\s*-\s*id:\s*(\S+)/.exec(line)
    if (idMatch) {
      if (current) rows.push(current)
      const rowIndent = line.indexOf('-')
      current = {
        id: idMatch[1],
        name: undefined,
        origin,
        insert: insertIndent !== undefined && rowIndent > insertIndent,
      }
      continue
    }
    const nameMatch = /^\s*name:\s*['"]?([^'"\s]+)['"]?/.exec(line)
    if (nameMatch && current && current.name === undefined) current.name = nameMatch[1]
  }
  if (current) rows.push(current)
}

const bundles = profilePkg?.dsh?.profile?.bundles ?? []
for (const bundle of bundles) {
  const { pkgPath, pkg } = bundlePackageJson(bundle)
  if (pkg === undefined) {
    problems.push(`bundle "${bundle}" is listed in dsh.profile.bundles but not resolvable (${pkgPath})`)
    continue
  }
  const patchRel = pkg?.dsh?.bundle?.patch
  if (typeof patchRel === 'string' && patchRel !== '') {
    collectPatch(resolve(dirname(pkgPath), patchRel), `bundle ${bundle}`)
  }
}
collectPatch(resolve(profileDir, 'cordis.patch.yml'), 'profile patch')

// The entry id a profile row uses is the bare package name (no scope).
const pluginEntryId = plugin.split('/').pop()
const insertRows = rows.filter(r => r.insert && r.name === plugin)
const overrideRows = rows.filter(r => !r.insert && (r.name === plugin || r.id === pluginEntryId))
const staticRows = insertRows
const staticIds = staticRows.map(r => String(r.id).replace(/^['"]|['"]$/g, ''))

// Runtime path: the super-injector registry re-injects every recorded package on
// startup, unless the package is already owned by the static bundle layer.
const registryPath = join(home, 'super-injector', 'registry.json')
const registry = readJson(registryPath)
const registryEntries = Array.isArray(registry) ? registry : []
const injectedRows = registryEntries.filter(e => e?.name === plugin)

console.log('=== static composition (what dsh web mounts at boot) ===')
console.log(`profile          : ${profileName} (${profileDir})`)
console.log(`bundles          : ${bundles.length}`)
console.log(`patch files      : ${patchFiles.length}`)
for (const f of patchFiles) console.log(`  - ${f}`)
console.log(`insert rows for ${plugin}: ${staticRows.length}`)
for (const r of staticRows) console.log(`  - id=${r.id} (from ${r.origin})`)
console.log(`override rows for ${plugin}: ${overrideRows.length}`)
for (const r of overrideRows) console.log(`  - id=${r.id} (from ${r.origin}) — merges into the inserted row, not a second mount`)

console.log('')
console.log('=== runtime path (super-injector restore) ===')
console.log(`registry         : ${registryPath}`)
console.log(`entries total    : ${registryEntries.length}`)
console.log(`entries for ${plugin}: ${injectedRows.length}`)

const duplicateIds = staticIds.filter((id, i) => staticIds.indexOf(id) !== i)
if (duplicateIds.length > 0) {
  problems.push(`duplicate loader entry id in the composition: ${[...new Set(duplicateIds)].join(', ')}`)
}
if (staticRows.length > 1) {
  problems.push(`${plugin} is mounted ${staticRows.length} times by the static composition (expected 1)`)
}
if (staticRows.length > 0 && injectedRows.length > 0) {
  problems.push(
    `${plugin} is loaded by BOTH paths: static bundles (${staticRows.length} row) AND the injector registry `
    + `(${injectedRows.length} entry) — it would mount twice and re-register its adapters and routes, and dsh web would fail to start`,
  )
}
if (staticRows.length === 0 && injectedRows.length === 0) {
  // Not installed in this profile is a legitimate state: this repo's own build
  // runs on machines that never installed the plugin. Only a *duplicate* is the
  // failure this check exists to catch.
  console.log('')
  console.log('=== verdict ===')
  console.log(`SKIP  : ${plugin} is not installed in this profile (neither bundles nor injector registry)`)
  process.exit(0)
}
if (staticRows.length > 0) {
  notes.push(`authoritative path: profile bundles (injector must not re-inject it)`)
} else {
  notes.push(`authoritative path: super-injector registry (runtime-only injection)`)
}

console.log('')
console.log('=== verdict ===')
for (const n of notes) console.log(`note  : ${n}`)
if (problems.length === 0) {
  console.log(`PASS  : ${plugin} is loaded by exactly one path — no duplicate mount`)
  process.exit(0)
}
for (const p of problems) console.log(`FAIL  : ${p}`)
process.exit(1)
