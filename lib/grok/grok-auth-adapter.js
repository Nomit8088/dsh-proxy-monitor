/**
 * The LLM adapter half of the grok-auth plugin: registers the `xai` route
 * with a pi-ai-backed adapter that resolves the xAI OAuth access token from
 * the live Grok CLI auth file (refreshing through the official auth.x.ai
 * endpoint when it is about to expire) instead of through the credentials
 * seam — which is single-provider by design and cannot be extended from a
 * plugin.
 *
 * Everything provider-specific — the api.x.ai OpenAI-compatible protocols,
 * tool calls, streaming, the model catalog — is the installed pi-ai `xai`
 * provider, wrapped by the harness's own `PiAiAdapter`; this package only
 * supplies the credential and the route. A subscription OAuth access token is
 * accepted by api.x.ai as a Bearer credential (the same construction pi-ai's
 * own xAI subscription login uses), so the request-level `apiKey` override is
 * the entire integration.
 *
 * @module dsh-grok-auth/grok-auth-adapter
 */
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { GrokModelCatalog } from './grok-models.js';
/** The provider route this adapter registers (the installed pi-ai catalog id). */
export const GROK_ROUTE = 'xai';
/** Default request timeout for the route. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
/** Provider-idle ceiling for one outstanding stream read, mirroring llm-pi-ai's default. */
const STREAM_IDLE_TIMEOUT_MS = 300_000;
/** llm-pi-ai's default maximum encoded image payload for one pi-ai request. */
export const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
/** llm-pi-ai's default total-pixel budget per deterministic inline request version. */
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048;
/** llm-pi-ai's default raw encoded-byte cap per deterministic inline request version. */
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;
/**
 * Grok owns authentication in the Host-side coordinator and injects its token
 * through `resolveApiKey` for each request. Pi-ai's login/storage surface must
 * therefore remain deliberately inert: allowing it to discover or persist a
 * second credential (an ambient XAI_API_KEY, its own subscription login)
 * would break the single-source and secret-boundary rules.
 */
export function grokAuthInjection() {
    const credentials = {
        read: async () => undefined,
        list: async () => [],
        modify: async () => {
            throw new LlmError('llm-grok-auth: pi-ai credential persistence is disabled; use the Grok auth coordinator', 'AUTH_PERSISTENCE_DISABLED');
        },
        delete: async () => { },
    };
    const authContext = {
        env: async () => undefined,
        fileExists: async () => false,
    };
    return { credentials, authContext };
}
/**
 * The installed pi-ai catalog provider for the xai route. Its api-key auth
 * method already accepts a request-level override, which is how the harness
 * token reaches every request; the models are delegated — through the live
 * discovery overlay when one is active, and with an optional endpoint
 * override — so the catalog provider stays the receiver.
 */
function grokProvider(displayName, baseUrl, catalog, imageModelIds) {
    const base = builtinProviders().find(candidate => candidate.id === GROK_ROUTE);
    if (base === undefined) {
        throw new Error('llm-grok-auth: the installed pi-ai catalog ships no xai provider');
    }
    const endpoint = baseUrl.length > 0 ? baseUrl : undefined;
    return {
        id: base.id,
        name: displayName,
        ...(endpoint ?? base.baseUrl) === undefined ? {} : { baseUrl: endpoint ?? base.baseUrl },
        auth: base.auth,
        getModels: () => {
            let models = catalog === undefined ? base.getModels() : catalog.merge(base.getModels());
            const ids = imageModelIds?.();
            if (ids !== undefined) {
                const selected = new Set(ids);
                models = models.map(model => ({
                    ...model,
                    input: selected.has(model.id) ? ['text', 'image'] : ['text'],
                }));
            }
            return endpoint === undefined ? models : models.map(model => ({ ...model, baseUrl: endpoint }));
        },
        // Delegated rather than copied: the catalog provider stays the receiver,
        // so an implementation holding state on itself keeps working.
        stream: (model, context, options) => base.stream(model, context, options),
        streamSimple: (model, context, options) => base.streamSimple(model, context, options),
    };
}
/**
 * The grok-auth LLM adapter: one fixed `xai` profile over the installed
 * pi-ai provider, with the credential resolved from the Grok auth file per
 * request.
 */
export class GrokAuthAdapter extends PiAiAdapter {
    visibleModelIds;
    constructor(ctx, options) {
        const catalog = options.catalog ?? (options.liveModels
            ? new GrokModelCatalog({
                resolveAccessToken: async () => (await options.auth.credential())?.accessToken,
                ...options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl },
                warn: message => { ctx.logger.warn('llm-grok-auth: %s', message); },
                ...options.onCatalogChange === undefined ? {} : { onChange: options.onCatalogChange },
            })
            : undefined);
        const profile = {
            provider: GROK_ROUTE,
            displayName: options.displayName,
            streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
            maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
            requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
            requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
            retryPolicy: resolveRetryPolicy(undefined, `llm-grok-auth: provider "${GROK_ROUTE}" retryPolicy`),
            piProvider: grokProvider(options.displayName, options.baseUrl, catalog, options.imageModelIds),
            // Empty on purpose: this route builds its provider from the installed
            // pi-ai catalog rather than from stored configuration, so no model can
            // have failed to construct. `dsh-llm-pi-ai` 0.1.5 made this field
            // required; up to 0.1.1-rc the shape omitted it.
            modelErrors: new Map(),
            configuredMaxTokens: new Map(),
            timeoutMs: options.timeoutMs,
        };
        const profiles = new Map([[GROK_ROUTE, profile]]);
        super({
            profiles: () => profiles,
            // This route always supplies its Host-only coordinator token through
            // resolveApiKey. Keep pi-ai's independent login and ambient discovery
            // fail-closed so no second credential path can capture or expose it.
            auth: grokAuthInjection(),
            // A missing or dead login answers fail-loud with the seam's coded
            // diagnostic, whose resolution is `grok login` — the agreed degradation
            // instead of letting pi-ai's ambient XAI_API_KEY discovery run.
            resolveApiKey: async () => {
                const credential = await options.auth.credential();
                if (credential === undefined) {
                    throw new LlmError(`llm-grok-auth: no usable Grok login for "${GROK_ROUTE}"; run "grok login" (or use the`
                        + ` "${options.credentialRef}" card on the Settings page) to sign in`, 'MISSING_CREDENTIAL');
                }
                return credential.accessToken;
            },
            resolveAttachments: () => ctx.get('attachments'),
        });
        this.visibleModelIds = options.visibleModelIds;
    }
    async listModels(provider) {
        const models = await super.listModels(provider);
        const visibleModelIds = this.visibleModelIds?.();
        if (visibleModelIds === undefined)
            return models;
        const visible = new Set(visibleModelIds);
        return models.filter(model => visible.has(model.id));
    }
}
//# sourceMappingURL=grok-auth-adapter.js.map