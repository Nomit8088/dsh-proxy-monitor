/**
 * Inspect the compiled CSS inside the built bundle.
 *
 * The rail and settings styles are CSS Modules compiled into `lib/client.js` as
 * an injected string. This script extracts that string and reports which theme
 * tokens and dark-scheme selectors actually survived the build — the quickest
 * way to confirm the plugin will follow light/dark without a runtime check.
 *
 * Run with:  node scripts/inspect-css.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

/**
 * Every injected-CSS literal in the bundle. tsdown renames the binding per
 * module (`css`, `css$1`, ...), so the name is captured rather than assumed —
 * and `$` is a valid identifier character that `\w` does not cover.
 */
const literals = [...bundle.matchAll(/const ([\w$]+) = ("(?:[^"\\]|\\.)*")/g)]
  .filter(match => {
    // Only style payloads: they carry CSS custom properties or a rule brace.
    const value = JSON.parse(match[2])
    return value.includes('--dsw-') || value.includes('{')
  })
  .map(match => ({ name: match[1], css: JSON.parse(match[2]) }))

if (literals.length === 0) {
  console.error('inspect-css: no injected CSS literal found — did the build run?')
  process.exit(1)
}

for (const [index, entry] of literals.entries()) {
  const css = entry.css
  console.log(`\n=== stylesheet ${String(index + 1)}: ${entry.name} (${String(css.length)} chars) ===`)

  const dark = [...css.matchAll(/[^{}]*data-ds-dark-theme[^{}]*\{/g)].map(match => match[0].trim())
  console.log(`dark-scheme selectors: ${String(dark.length)}`)
  for (const selector of dark) console.log(`  ${selector}`)

  const tokens = [...new Set(css.match(/--dsw-[a-z0-9-]+/g) ?? [])]
  console.log(`theme tokens referenced: ${String(tokens.length)}`)
  console.log(`  ${tokens.join(' ')}`)

  // A literal colour outside a var() fallback would not follow the theme.
  const suspicious = [...css.matchAll(/(?:^|[;:{]\s*)(?:color|background|border-color)\s*:\s*(#[0-9a-f]{3,8}|rgb[^;)]*\))/gi)]
    .map(match => match[0].trim())
  console.log(`non-token colour declarations: ${String(suspicious.length)}${suspicious.length > 0 ? ` -> ${suspicious.join(' | ')}` : ''}`)
}
