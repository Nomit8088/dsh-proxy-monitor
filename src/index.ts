/**
 * dsh-proxy-monitor, host half.
 *
 * Mounts three things on the Host plane:
 *
 * 1. the plugin's own options (which providers to show, where the rail sits,
 *    how often to poll) as `.volatile()` fields of this plugin's Config. Since
 *    DSH 0.1.7 the settings seam projects a plugin entry's volatile fields into
 *    that entry's config form, so a write from the settings page lands in the
 *    profile patch and the Loader commits the new values into these same
 *    references — `loader/volatile-update` — without remounting the plugin;
 * 2. the quota collector, which reads each provider's own credential source
 *    and quota endpoint;
 * 3. a plugin-owned Connection RPC channel, the only transport by which quota
 *    numbers — never credentials — reach the browser.
 *
 * Nothing here touches the LLM routes, the tool registry, or the session
 * lifecycle, so the plugin cannot perturb the agent's behaviour.
 *
 * @module @dsh-external/dsh-proxy-monitor
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

// Type-only imports: these pull in the declaration-merging augmentations that
// put `ctx.settings`, `ctx.credentials`, and `ctx.connection` on Context and
// declare the `loader/volatile-update` event this half listens to. They carry
// no runtime weight and are erased at compile time.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/cordis-plugin-loader'

import { QuotaCollector, PROVIDER_ORDER } from './collector.js'
import {
  PROXY_MONITOR_CHANNEL,
  type ProviderId,
  type RefreshResult,
} from './contract.js'
import { createQuotaBackedAdapters } from './accounts/adapters.js'
import { CodexAccountAdapter } from './accounts/codex.js'
import { AntigravityAccountAdapter } from './accounts/antigravity.js'
import { createGrokQuotaReader, GrokAccountAdapter } from './accounts/grok.js'
import { setupCodex } from './codex-integration.js'
import { setupAntigravity } from './antigravity-integration.js'
import { setupWorkBuddy } from './workbuddy-integration.js'
import { setupGrok } from './grok-integration.js'
import { registerPickerModelsApi } from './catalog-http.js'
import { AccountRegistry } from './accounts/registry.js'
import type { ProxiedProviderId } from './accounts/contract.js'
import { GrokAuthService } from './grok/grok-auth-service.js'
import { defaultAuthJsonPath } from './grok/grok-auth.js'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { reasonOf, type ProviderContext } from './providers/util.js'
import { resolveDshHome } from './home.js'
import { Config as WorkBuddyConfigSchema, type Config as WorkBuddySection } from './workbuddy/index.js'

export const name = '@dsh-external/dsh-proxy-monitor'

/**
 * Required Host services: the LLM registry.
 *
 * `llm` is not optional here even though most of this plugin reaches the
 * registry through a nested `ctx.inject(['llm'], …)`: the WorkBuddy runtime is
 * vendored whole and touches `ctx.llm` directly, so the *plugin's* inject list
 * is what decides whether its route may register at all. Omitting it made cordis
 * refuse the property access ("cannot get property \"llm\" without inject"),
 * which the vendored code catches and logs — leaving WorkBuddy selectable in
 * settings and absent from the composer's model picker.
 *
 * Neither `settings` nor `connection` is required:
 *
 * - `settings` no longer holds a plugin's configuration (0.1.7 projects the
 *   entry's own volatile Config), so a deployment without the seam must still
 *   get the rail, the collector, and the providers;
 * - `connection` is the browser transport, and only the plugin-owned RPC
 *   channel needs it. Requiring it kept the whole entry `pending (waiting for
 *   service: connection)` in every profile with no Web surface — a headless or
 *   TUI run would mount no collector at all.
 *
 * Both are therefore reached through optional `ctx.inject` children below.
 */
export const inject = ['llm']

/** The provider ids the settings schema accepts, derived from the readers. */
const PROVIDER_IDS = PROVIDER_ORDER as readonly string[]

/**
 * Plugin configuration.
 *
 * Every editable field is `.volatile()`, which is exactly what makes it visible
 * to the settings seam: `dsh-settings` projects an entry's volatile fields into
 * that entry's form, and the Loader keeps those same references live by writing
 * committed values into them. A field left non-volatile would be ordinary
 * composition configuration, editable only by hand in the profile patch.
 *
 * Declared as an interface of `Volatile<T>` fields beside the schema itself
 * (the pattern the shipped plugins use): the schema is what the Loader reads,
 * the interface is what `apply` receives.
 */
export interface Config {
  /** Whether the floating rail is shown at all. */
  enabled: Volatile<boolean>
  /** Providers to show, in the order given; others are read but not rendered. */
  providers: Volatile<string[]>
  /** Where the rail sits against the viewport edge. */
  anchor: Volatile<'right' | 'left'>
  /** Vertical placement of the rail. */
  align: Volatile<'center' | 'top' | 'bottom'>
  /** Opacity of the rail when the pointer is away from it. */
  restingOpacity: Volatile<number>
  /** Whether the ring shows the numeric percentage under it. */
  showPercent: Volatile<boolean>
  /** Whether a ring may be expanded by hovering, or only by clicking. */
  expandOnHover: Volatile<boolean>
  /** How long a snapshot stays fresh before a background re-read, in seconds. */
  refreshSeconds: Volatile<number>
  /** Order the rows by name instead of by the configured `providers` order. */
  sortAlphabetically: Volatile<boolean>
  /**
   * Whether the rail may shift DSH's own turn navigator aside when the two
   * would overlap. Only ever moves that navigator left by the overlap.
   */
  yieldToTurnNav: Volatile<boolean>
  /**
   * The vendored WorkBuddy runtime's own fields, nested under this entry so a
   * single configuration surface owns them and the configurable-provider
   * directory can point at `workbuddy` inside this entry.
   */
  workbuddy: Volatile<WorkBuddySection>
}

export const Config = z.object({
  enabled: z.boolean().default(true).description('显示额度监控侧栏').volatile(),
  providers: z
    .array(z.union(PROVIDER_IDS as [string, ...string[]]))
    .default(['deepseek', 'codex', 'workbuddy', 'antigravity', 'grok'])
    .description('在侧栏中展示哪些提供商')
    .volatile(),
  anchor: z.union(['right', 'left']).default('right').description('侧栏贴靠的屏幕边缘').volatile(),
  align: z.union(['center', 'top', 'bottom']).default('center').description('侧栏的垂直位置').volatile(),
  restingOpacity: z
    .natural()
    .min(0)
    .max(100)
    .default(82)
    .description('未悬停时的透明度（%），越低越不干扰阅读')
    .volatile(),
  showPercent: z.boolean().default(true).description('在圆环下方显示百分比数字').volatile(),
  expandOnHover: z.boolean().default(true).description('悬停即展开详情卡（关闭后需点击展开）').volatile(),
  refreshSeconds: z
    .natural()
    .min(15)
    .max(3600)
    .default(60)
    .description('额度自动刷新间隔（秒），最小 15 秒')
    .volatile(),
  sortAlphabetically: z.boolean().default(false).description('按名称排序（关闭则按上面的提供商顺序）').volatile(),
  yieldToTurnNav: z
    .boolean()
    .default(true)
    .description('与对话轮次导航条重叠时，把导航条向左让开（不改动本插件位置）')
    .volatile(),
  workbuddy: WorkBuddyConfigSchema.default({})
    .description('WorkBuddy 桌面端凭据路径与推理档位探测授权')
    .volatile(),
})

/** One `bad-request` failure in the Connection RPC result shape. */
function badRequest(message: string): {
  ok: false
  error: { code: string; message: string; details: object }
} {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

/** The proxied provider ids the account endpoints accept. */
const PROXIED_IDS = ['codex', 'antigravity', 'workbuddy', 'grok'] as const

/**
 * Read a proxied provider id out of an RPC payload.
 *
 * Validated against the closed set rather than cast, because the payload
 * crosses a browser boundary: an unchecked value would reach a `Map.get` and
 * silently answer "no such provider" for a typo, or worse, be trusted later.
 *
 * @param payload - the validated object payload, or undefined when none was sent.
 * @returns the provider id, or undefined when it is absent or not one of ours.
 */
function providerOf(payload: object | undefined): ProxiedProviderId | undefined {
  const value = (payload as Record<string, unknown> | undefined)?.['id']
  return typeof value === 'string' && (PROXIED_IDS as readonly string[]).includes(value)
    ? (value as ProxiedProviderId)
    : undefined
}

/**
 * Read a required non-blank string field out of an RPC payload.
 * @param payload - the validated object payload, or undefined when none was sent.
 * @param key - field name.
 * @returns the trimmed value, or undefined when absent or blank.
 */
function strField(payload: object | undefined, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Mount the collector, the configuration surface, and the browser transport.
 * @param ctx - host plugin context.
 * @param config - the live configuration references the Loader keeps updated.
 */
export function apply(ctx: Context, config: Config): void {
  // The credential seam is optional: a deployment without dsh-credentials
  // simply cannot read DeepSeek, while every OAuth-backed provider still works.
  const providerContext: ProviderContext = {
    home: resolveDshHome(),
    credential: async ref => {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return undefined
      try {
        const resolved = await credentials.resolve(ref as Parameters<typeof credentials.resolve>[0])
        return resolved?.value
      } catch (error) {
        ctx.logger.warn('dsh-proxy-monitor: credential %s failed: %s', ref, reasonOf(error))
        return undefined
      }
    },
    warn: (provider, message) => {
      ctx.logger.warn('dsh-proxy-monitor: %s: %s', provider, message)
    },
  }

  // Sibling plugins publish their normalized quota on loopback routes of this
  // same server, whose port is only known once webServer has bound. The base
  // URL is therefore re-resolved on every read rather than captured once at
  // apply time.
  const pluginBase = (): string => {
    const server = ctx.get('webServer')
    const port = server?.port
    const host = server?.host === '0.0.0.0' ? '127.0.0.1' : (server?.host ?? '127.0.0.1')
    return `http://${host}:${String(port ?? 3080)}`
  }

  // The account face shares the collector's provider context and its
  // re-resolved origin, so an account read and a quota read always describe the
  // same credential in the same deployment.
  //
  // Grok is registered with its real adapter (a Host-run device-code login);
  // the other three still ride their quota readers until their login flows are
  // migrated. The split is visible here rather than hidden behind a flag, so
  // "which providers can actually sign in" is answerable by reading this block.
  const grokService = new GrokAuthService(
    {
      logger: {
        warn: (message, ...args) => {
          ctx.logger.warn(message, ...args)
        },
      },
      effect: (callback, label) => {
        ctx.effect(callback, label)
      },
    },
    {
      authJsonPath: defaultAuthJsonPath(),
      grokCommand: 'grok',
      credentialRef: credentialRef('GROK_OAUTH_TOKEN'),
    },
  )

  let intervalMs = config.refreshSeconds.get() * 1000
  const collector = new QuotaCollector({
    context: providerContext,
    pluginBase: pluginBase(),
    intervalMs,
    warn: message => {
      ctx.logger.warn('dsh-proxy-monitor: %s', message)
    },
    // Grok's quota must be read through the service that owns its credential.
    // The default table's standalone reader would read the same file without
    // refreshing it, so an expired token could paint the rail red while the
    // settings panel — which goes through the service — reported healthy.
    overrides: {
      grok: createGrokQuotaReader(grokService),
    },
  })
  ctx.effect(
    () => () => {
      collector.dispose()
    },
    'dsh-proxy-monitor: collector',
  )

  // Codex full backend services & route integration:
  const codex = setupCodex(ctx)

  // Antigravity backend services & route integration:
  const antigravity = setupAntigravity(ctx)

  // WorkBuddy (CN) backend services & route integration. It reads its three
  // fields through thunks into this plugin's live Config: the vendored runtime
  // consults them from long-lived closures (a probe's consent check, a store's
  // desktop path), so a snapshot taken at apply time would freeze the first
  // value it ever saw.
  const workbuddy = setupWorkBuddy(ctx, {
    authFile: () => config.workbuddy.get().authFile,
    authFileAI: () => config.workbuddy.get().authFileAI,
    probeConsent: () => config.workbuddy.get().probeConsent === true,
  })

  // Grok LLM adapter (when free) + live model catalog:
  setupGrok(ctx, grokService)

  // Read-only diagnosis of what the conversation model picker can actually
  // select. Registered after every adapter setup so it reports the topology the
  // user ends up with, not an intermediate one.
  registerPickerModelsApi(ctx)

  const accounts = new AccountRegistry([
    new CodexAccountAdapter(codex.credentials, codex.webAuth, async () => await collector.snapshot()),
    new AntigravityAccountAdapter(antigravity.store, async () => await collector.snapshot()),
    ...createQuotaBackedAdapters(async () => await collector.snapshot()),
    new GrokAccountAdapter(grokService, async () => await collector.snapshot()),
  ])

  /**
   * Apply the two pieces of live state a plain read cannot pick up on its own.
   *
   * Both are values *copied* out of the configuration at construction time: the
   * collector's freshness window, and each WorkBuddy store's desktop-file path.
   * The origin is re-resolved every time because the web server may bind after
   * this plugin mounts. Everything else — the roster, the placement, the
   * opacity — is read by the browser straight from the same form, so the Host
   * has nothing to re-point for it.
   */
  const syncSettings = (): void => {
    collector.setPluginBase(pluginBase())
    const nextInterval = config.refreshSeconds.get() * 1000
    if (nextInterval !== intervalMs) {
      intervalMs = nextInterval
      collector.setInterval(intervalMs)
    }
    workbuddy.repoint()
  }

  // A settings write commits into the volatile references above and then emits
  // this event on this plugin's own fiber; it is the only notification a
  // volatile-only change produces (the plugin is not remounted).
  ctx.effect(() => {
    syncSettings()
    return ctx.on('loader/volatile-update', () => {
      syncSettings()
    })
  }, 'dsh-proxy-monitor: live settings')

  /**
   * This plugin ships its own settings page — the browser half registers two
   * sections into `settings.section` — so the seam must not *also* generate a
   * generic page for this entry. The policy is registered from an optional
   * child because the business plugin neither needs nor requires the seam.
   */
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'dsh-proxy-monitor: settings presentation',
    )
  })

  ctx.inject(['connection'], connectionCtx => {
    // The channel registration is scoped to the calling fiber by the service
    // proxy, and the returned disposer is wired through ctx.effect so an unload
    // (or a hot reload) always removes the route.
    connectionCtx.effect(
      () =>
        connectionCtx.connection.rpc.handle(PROXY_MONITOR_CHANNEL, async (endpoint, payload, signal) => {
          if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
            return badRequest('payload must be an object')
          }
          try {
            if (endpoint === 'snapshot') {
              if (signal.aborted) throw new Error('request was cancelled')
              return { ok: true as const, value: await collector.snapshot() }
            }
            if (endpoint === 'refresh') {
              const snapshot = await collector.refresh()
              const result: RefreshResult = {
                snapshot,
                failed: snapshot.providers
                  .filter(provider => provider.status === 'error')
                  .map(provider => provider.id),
              }
              return { ok: true as const, value: result }
            }

            // Account endpoints. Each acts on one provider's session, which is
            // why they are separate from the snapshot pair above: a login must
            // be pollable without forcing a quota re-read of every provider.
            if (endpoint === 'accounts') {
              if (signal.aborted) throw new Error('request was cancelled')
              return { ok: true as const, value: await accounts.accounts() }
            }
            if (endpoint === 'login' || endpoint === 'logout') {
              const provider = providerOf(payload)
              if (provider === undefined) return badRequest('payload.id must name a proxied provider')
              if (endpoint === 'logout') {
                return { ok: true as const, value: { ok: await accounts.logout(provider) } }
              }
              const ticket = await accounts.beginLogin(provider)
              if (ticket === undefined) {
                return badRequest(`${provider} has no login flow in this build`)
              }
              return { ok: true as const, value: ticket }
            }
            if (endpoint === 'loginPoll') {
              const provider = providerOf(payload)
              if (provider === undefined) return badRequest('payload.id must name a proxied provider')
              const ticketId = strField(payload, 'ticketId')
              if (ticketId === undefined) return badRequest('payload.ticketId is required')
              const ticket = await accounts.pollLogin(provider, ticketId)
              if (ticket === undefined) {
                return badRequest(`${provider} has no login flow in this build`)
              }
              return { ok: true as const, value: ticket }
            }

            return badRequest(`unknown dsh-proxy-monitor endpoint ${JSON.stringify(endpoint)}`)
          } catch (error) {
            return { ok: false as const, error: { code: 'internal', message: reasonOf(error), details: {} } }
          }
        }),
      'dsh-proxy-monitor: rpc channel',
    )
  })

  ctx.logger.info(
    'dsh-proxy-monitor: %s providers, refresh every %ss',
    String(config.providers.get().length),
    String(config.refreshSeconds.get()),
  )
}
