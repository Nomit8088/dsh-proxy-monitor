/**
 * tsdown build for the browser half.
 *
 * Produces exactly the artifact the DSH shell expects: a CJS closure wrapped in
 * `window.__ModuleLoader__.load({ id, factory })`, with every `@deepseek-ai/*`
 * runtime import left external (they are resolved from the shell's module
 * table) and everything else inlined.
 *
 * Two things are specific to this plugin:
 *
 * - **CSS Modules are compiled and injected as a `<style data-plugin>` tag.**
 *   The plugin owns its stylesheet, so an unload leaves no orphan rules; the
 *   virtual-module trick keeps the CSS away from tsdown's own css pipeline.
 * - **`react` is the only React entry left external** (plus `jsx-runtime`).
 *   Everything else — the icons, the rail, the settings section — is bundled,
 *   so the plugin ships as one file.
 *
 * Types come from `tsc`, not from here: the host half's declarations are
 * emitted by the tsc pass in scripts/build.mjs.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PLUGIN_ID = '@dsh-external/dsh-proxy-monitor'

/**
 * Module-table words the browser shell seeds as platform singletons.
 *
 * This list is NOT a guess: it mirrors the shell's own `staticModules` table
 * (web boot builds it in the frontend entry). A word here resolves through the
 * module table's first branch and therefore needs no arrival edge.
 *
 * Two things are notable:
 *
 * - **`@deepseek-ai/dsh-client-ui-primitives` is seeded**, so a plugin may
 *   require it directly. The merged Grok settings card does exactly that.
 * - **`@deepseek-ai/cordis` is the seeded spelling**, not `cordis`; a bare
 *   `cordis` is not a table word and would throw at materialization.
 */
const CLIENT_SEED = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * Package rows that arrive as boot-graph entries rather than seed words.
 *
 * Each of these declares `dsh.client` with `platform: "web"`, so the modules
 * node half composes it into `window.__DSH_BOOT__` and its factory is fetched
 * during boot. Requiring one is safe **only** when its arrival is ordered
 * before this bundle materializes — which is what the matching entries in
 * `package.json` → `dsh.client.inject` are for. The two lists are one contract:
 * a name added here without its `inject` edge is a runtime "module not
 * registered" crash, not a build error.
 */
const CLIENT_GRAPH = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-tool',
]

/**
 * Module-table entries the browser shell supplies; everything else is inlined.
 *
 * Keeping these external is what lets the merged browser half register into
 * slots owned by ui-settings / ui-conversation / ui-tool: bundling a second
 * copy of any of them would give this plugin a *private* slot registry, and its
 * registrations would then never appear in the real UI.
 */
const CLIENT_EXTERNALS = [...CLIENT_SEED, ...CLIENT_GRAPH]

/**
 * Whether one module id is answered by the shell's module table.
 *
 * The module table normalizes `<pkg>/client` onto the bare package row, so a
 * bundle may import either spelling. Matching strips that suffix here too;
 * otherwise a `/client` import would silently inline a second copy of a package
 * the shell already owns.
 * @param id - module specifier as the bundler sees it.
 * @returns true when the shell supplies this module.
 */
function isClientExternal(id: string): boolean {
  const bare = id.endsWith('/client') ? id.slice(0, -'/client'.length) : id
  return CLIENT_EXTERNALS.includes(bare)
}

/**
 * Fail the build when the browser half imports a `@deepseek-ai/*` package the
 * shell does not supply.
 *
 * Without this gate the mistake surfaces only at runtime, as a bare "module not
 * registered" inside the browser console with no pointer back to the import.
 * The build-time message names the specifier and the two legitimate fixes, which
 * is the difference between a one-minute and a one-hour diagnosis.
 */
function clientPurityPlugin(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-proxy-monitor-client-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (isClientExternal(source)) return null
      throw new Error(
        `client bundle purity: ${JSON.stringify(source)} is not supplied by the Web shell; `
        + 'use a type-only import (`import type`) or reach it through a Cordis service',
      )
    },
  }
}

const CSS_VIRTUAL_PREFIX = '\0dsh-proxy-monitor-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Compile CSS Modules into a hashed class map plus one injected style element.
 *
 * The style tag is keyed by `<plugin id>/<file>` so a re-registration (a hot
 * reload) replaces nothing and duplicates nothing, and the tag carries
 * `data-plugin` so the shell's plugin teardown can find it.
 */
function cssModulesPlugin() {
  return {
    name: 'dsh-proxy-monitor-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const file = importer === undefined ? source : resolve(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + file + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const file = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(file)
      const source = await readFile(file)
      const { code, exports } = transform({
        filename: file,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes: Record<string, string> = {}
      for (const [local, value] of Object.entries(exports ?? {})) classes[local] = value.name
      const styleId = `${PLUGIN_ID}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const styleId = ${JSON.stringify(styleId)};`,
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId) + "]") === null) {',
        '  const style = document.createElement("style");',
        `  style.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        '  style.dataset.pluginCss = styleId;',
        '  style.textContent = css;',
        '  document.head.appendChild(style);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}

const clientBundle: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  // Module-table entries stay external (resolved from the shell's table);
  // every other dependency inlines, so the plugin ships as one file.
  deps: {
    neverBundle: (id: string) => isClientExternal(id),
    alwaysBundle: (id: string) => !isClientExternal(id),
  },
  plugins: [clientPurityPlugin(), cssModulesPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    // The CJS wrapper's `require` only resolves module-table entries, so the
    // bundle must be a single script with no relative chunk fetches.
    codeSplitting: false,
  },
}

export default [clientBundle] satisfies UserConfig[]
