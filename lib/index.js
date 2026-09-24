/**
 * dsh-proxy-monitor, host half.
 *
 * Mounts three things on the Host plane:
 *
 * 1. the `dsh-proxy-monitor` settings namespace, so the plugin's own options
 *    (which providers to show, where the rail sits, how often to poll) live in
 *    the user settings document beside every other plugin's;
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
import z from '@deepseek-ai/schemastery';
import { QuotaCollector, PROVIDER_ORDER } from './collector.js';
import { PROXY_MONITOR_CHANNEL, PROXY_MONITOR_NAMESPACE, } from './contract.js';
import { createQuotaBackedAdapters } from './accounts/adapters.js';
import { CodexAccountAdapter } from './accounts/codex.js';
import { AntigravityAccountAdapter } from './accounts/antigravity.js';
import { createGrokQuotaReader, GrokAccountAdapter } from './accounts/grok.js';
import { setupCodex } from './codex-integration.js';
import { setupAntigravity } from './antigravity-integration.js';
import { setupWorkBuddy } from './workbuddy-integration.js';
import { setupGrok } from './grok-integration.js';
import { registerPickerModelsApi } from './catalog-http.js';
import { AccountRegistry } from './accounts/registry.js';
import { GrokAuthService } from './grok/grok-auth-service.js';
import { defaultAuthJsonPath } from './grok/grok-auth.js';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { reasonOf } from './providers/util.js';
import { resolveDshHome } from './home.js';
export const name = '@dsh-external/dsh-proxy-monitor';
/**
 * Required Host services: provider configuration, the browser transport, and
 * the LLM registry.
 *
 * `llm` is not optional here even though most of this plugin reaches the
 * registry through a nested `ctx.inject(['llm'], …)`: the WorkBuddy runtime is
 * vendored whole and touches `ctx.llm` directly, so the *plugin's* inject list
 * is what decides whether its route may register at all. Omitting it made cordis
 * refuse the property access ("cannot get property \"llm\" without inject"),
 * which the vendored code catches and logs — leaving WorkBuddy selectable in
 * settings and absent from the composer's model picker.
 */
export const inject = ['settings', 'connection', 'llm'];
/** The provider ids the settings schema accepts, derived from the readers. */
const PROVIDER_IDS = PROVIDER_ORDER;
export const Config = z.object({
    enabled: z.boolean().default(true).description('显示额度监控侧栏'),
    providers: z
        .array(z.union(PROVIDER_IDS))
        .default(['deepseek', 'codex', 'workbuddy', 'antigravity', 'grok'])
        .description('在侧栏中展示哪些提供商'),
    anchor: z.union(['right', 'left']).default('right').description('侧栏贴靠的屏幕边缘'),
    align: z.union(['center', 'top', 'bottom']).default('center').description('侧栏的垂直位置'),
    restingOpacity: z
        .natural()
        .min(0)
        .max(100)
        .default(82)
        .description('未悬停时的透明度（%），越低越不干扰阅读'),
    showPercent: z.boolean().default(true).description('在圆环下方显示百分比数字'),
    expandOnHover: z.boolean().default(true).description('悬停即展开详情卡（关闭后需点击展开）'),
    refreshSeconds: z
        .natural()
        .min(15)
        .max(3600)
        .default(60)
        .description('额度自动刷新间隔（秒），最小 15 秒'),
    sortAlphabetically: z.boolean().default(false).description('按名称排序（关闭则按上面的提供商顺序）'),
    yieldToTurnNav: z
        .boolean()
        .default(true)
        .description('与对话轮次导航条重叠时，把导航条向左让开（不改动本插件位置）'),
});
/** One `bad-request` failure in the Connection RPC result shape. */
function badRequest(message) {
    return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } };
}
/** The proxied provider ids the account endpoints accept. */
const PROXIED_IDS = ['codex', 'antigravity', 'workbuddy', 'grok'];
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
function providerOf(payload) {
    const value = payload?.['id'];
    return typeof value === 'string' && PROXIED_IDS.includes(value)
        ? value
        : undefined;
}
/**
 * Read a required non-blank string field out of an RPC payload.
 * @param payload - the validated object payload, or undefined when none was sent.
 * @param key - field name.
 * @returns the trimmed value, or undefined when absent or blank.
 */
function strField(payload, key) {
    const value = payload?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
/**
 * Mount the collector, its settings namespace, and the browser transport.
 * @param ctx - host plugin context.
 * @param config - composed configuration (schema defaults, then user layer).
 */
export function apply(ctx, config) {
    // The credential seam is optional: a deployment without dsh-credentials
    // simply cannot read DeepSeek, while every OAuth-backed provider still works.
    const providerContext = {
        home: resolveDshHome(),
        credential: async (ref) => {
            const credentials = ctx.get('credentials');
            if (credentials === undefined)
                return undefined;
            try {
                const resolved = await credentials.resolve(ref);
                return resolved?.value;
            }
            catch (error) {
                ctx.logger.warn('dsh-proxy-monitor: credential %s failed: %s', ref, reasonOf(error));
                return undefined;
            }
        },
        warn: (provider, message) => {
            ctx.logger.warn('dsh-proxy-monitor: %s: %s', provider, message);
        },
    };
    // Sibling plugins publish their normalized quota on loopback routes of this
    // same server, whose port is only known once webServer has bound. The base
    // URL is therefore re-resolved on every settings change rather than captured
    // once at apply time.
    const pluginBase = () => {
        const server = ctx.get('webServer');
        const port = server?.port;
        const host = server?.host === '0.0.0.0' ? '127.0.0.1' : (server?.host ?? '127.0.0.1');
        return `http://${host}:${String(port ?? 3080)}`;
    };
    // The account face shares the collector's provider context and its
    // re-resolved origin, so an account read and a quota read always describe the
    // same credential in the same deployment.
    //
    // Grok is registered with its real adapter (a Host-run device-code login);
    // the other three still ride their quota readers until their login flows are
    // migrated. The split is visible here rather than hidden behind a flag, so
    // "which providers can actually sign in" is answerable by reading this block.
    const grokService = new GrokAuthService({
        logger: {
            warn: (message, ...args) => {
                ctx.logger.warn(message, ...args);
            },
        },
        effect: (callback, label) => {
            ctx.effect(callback, label);
        },
    }, {
        authJsonPath: defaultAuthJsonPath(),
        grokCommand: 'grok',
        credentialRef: credentialRef('GROK_OAUTH_TOKEN'),
    });
    let intervalMs = config.refreshSeconds * 1000;
    const collector = new QuotaCollector({
        context: providerContext,
        pluginBase: pluginBase(),
        intervalMs,
        warn: message => {
            ctx.logger.warn('dsh-proxy-monitor: %s', message);
        },
        // Grok's quota must be read through the service that owns its credential.
        // The default table's standalone reader would read the same file without
        // refreshing it, so an expired token could paint the rail red while the
        // settings panel — which goes through the service — reported healthy.
        overrides: {
            grok: createGrokQuotaReader(grokService),
        },
    });
    ctx.effect(() => () => {
        collector.dispose();
    }, 'dsh-proxy-monitor: collector');
    // Codex full backend services & route integration:
    const codex = setupCodex(ctx);
    // Antigravity backend services & route integration:
    const antigravity = setupAntigravity(ctx);
    // WorkBuddy (CN) backend services & route integration:
    setupWorkBuddy(ctx);
    // Grok LLM adapter (when free) + live model catalog:
    setupGrok(ctx, grokService);
    // Read-only diagnosis of what the conversation model picker can actually
    // select. Registered after every adapter setup so it reports the topology the
    // user ends up with, not an intermediate one.
    registerPickerModelsApi(ctx);
    const accounts = new AccountRegistry([
        new CodexAccountAdapter(codex.credentials, codex.webAuth, async () => await collector.snapshot()),
        new AntigravityAccountAdapter(antigravity.store, async () => await collector.snapshot()),
        ...createQuotaBackedAdapters(async () => await collector.snapshot()),
        new GrokAccountAdapter(grokService, async () => await collector.snapshot()),
    ]);
    const scope = ctx.settings.register(PROXY_MONITOR_NAMESPACE, Config, { applies: 'live' });
    // Keep the live interval and base URL in step with the settings document, so
    // a change in the UI takes effect without a reload.
    ctx.effect(() => scope.watch(next => {
        collector.setPluginBase(pluginBase());
        const nextInterval = next.refreshSeconds * 1000;
        if (nextInterval !== intervalMs) {
            intervalMs = nextInterval;
            collector.setInterval(intervalMs);
        }
    }), 'dsh-proxy-monitor: settings watch');
    ctx.inject(['connection'], connectionCtx => {
        // The channel registration is scoped to the calling fiber by the service
        // proxy, and the returned disposer is wired through ctx.effect so an unload
        // (or a hot reload) always removes the route.
        connectionCtx.effect(() => connectionCtx.connection.rpc.handle(PROXY_MONITOR_CHANNEL, async (endpoint, payload, signal) => {
            if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
                return badRequest('payload must be an object');
            }
            try {
                if (endpoint === 'snapshot') {
                    if (signal.aborted)
                        throw new Error('request was cancelled');
                    return { ok: true, value: await collector.snapshot() };
                }
                if (endpoint === 'refresh') {
                    const snapshot = await collector.refresh();
                    const result = {
                        snapshot,
                        failed: snapshot.providers
                            .filter(provider => provider.status === 'error')
                            .map(provider => provider.id),
                    };
                    return { ok: true, value: result };
                }
                // Account endpoints. Each acts on one provider's session, which is
                // why they are separate from the snapshot pair above: a login must
                // be pollable without forcing a quota re-read of every provider.
                if (endpoint === 'accounts') {
                    if (signal.aborted)
                        throw new Error('request was cancelled');
                    return { ok: true, value: await accounts.accounts() };
                }
                if (endpoint === 'login' || endpoint === 'logout') {
                    const provider = providerOf(payload);
                    if (provider === undefined)
                        return badRequest('payload.id must name a proxied provider');
                    if (endpoint === 'logout') {
                        return { ok: true, value: { ok: await accounts.logout(provider) } };
                    }
                    const ticket = await accounts.beginLogin(provider);
                    if (ticket === undefined) {
                        return badRequest(`${provider} has no login flow in this build`);
                    }
                    return { ok: true, value: ticket };
                }
                if (endpoint === 'loginPoll') {
                    const provider = providerOf(payload);
                    if (provider === undefined)
                        return badRequest('payload.id must name a proxied provider');
                    const ticketId = strField(payload, 'ticketId');
                    if (ticketId === undefined)
                        return badRequest('payload.ticketId is required');
                    const ticket = await accounts.pollLogin(provider, ticketId);
                    if (ticket === undefined) {
                        return badRequest(`${provider} has no login flow in this build`);
                    }
                    return { ok: true, value: ticket };
                }
                return badRequest(`unknown dsh-proxy-monitor endpoint ${JSON.stringify(endpoint)}`);
            }
            catch (error) {
                return { ok: false, error: { code: 'internal', message: reasonOf(error), details: {} } };
            }
        }), 'dsh-proxy-monitor: rpc channel');
    });
    ctx.logger.info('dsh-proxy-monitor: %s providers, refresh every %ss', String(config.providers.length), String(config.refreshSeconds));
}
//# sourceMappingURL=index.js.map