/**
 * Optional OpenAI Codex subscription bundle with ChatGPT OAuth, Codex models,
 * standalone search, browser settings, and vision-aware image input.
 * @module dsh-codex
 */
import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { createOpenAICodexAdapter, openAICodexModelCatalog, } from "./adapter.js";
import { registerOpenAICodexAuthRoutes } from "./auth-routes.js";
import { installReadImageEnhancement } from "./read-image-enhancement.js";
import { imagegenTool } from "./imagegen.js";
import { FastModeRegistry } from "./fast-mode.js";
import { assertNoOpenAICodexProviderConflict } from "./doctor.js";
import { installOpenAICodexSearchEvent, recordOpenAICodexSearchRequest, } from "./search-event.js";
export { READ_IMAGE_TOOL_NAME } from "./read-image-enhancement.js";
export { IMAGEGEN_TOOL_NAME, OPENAI_CODEX_IMAGE_EDITS_URL, OPENAI_CODEX_IMAGE_GENERATIONS_URL, OPENAI_CODEX_IMAGE_MODEL, OpenAICodexImageClient, } from "./imagegen.js";
export { DEFAULT_CONTEXT_WINDOW_PREFERENCES, DEFAULT_FAST_MODE_PREFERENCES, DEFAULT_IMAGE_TOOL_PREFERENCES, DEFAULT_RESPONSE_API_PREFERENCES, ImageToolPolicy, } from "./tool-policy.js";
export { isOpenAICodexReauthRequiredError, OPENAI_CODEX_REAUTH_REQUIRED_CODE, OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE, OPENAI_CODEX_USAGE_URL, OpenAICodexReauthRequiredError, parseOpenAICodexUsage, readOpenAICodexRateLimits, } from "./usage.js";
export { installOpenAICodexSearchEvent, OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT, recordOpenAICodexSearchRequest, } from "./search-event.js";
import { DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE, DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_CODEX_SEARCH_MODE, DEFAULT_OPENAI_CODEX_SEARCH_MODEL, OpenAICodexSearchProvider, } from "./search.js";
import { OPENAI_CODEX_PROVIDER } from "./store.js";
import { OpenAICodexService } from "./service.js";
import { DEFAULT_PROXY_PREFERENCES } from "./proxy.js";
export { OpenAICodexService } from "./service.js";
export { DEFAULT_PROXY_PREFERENCES, normalizeProxyUrl, OpenAICodexProxyTransport, } from "./proxy.js";
export { assertNoOpenAICodexProviderConflict, diagnoseOpenAICodex, openAICodexConflictMessage, } from "./doctor.js";
export { FastModeRegistry, isFastModeSessionId, OPENAI_CODEX_FAST_MODE_MAX_SESSIONS, OPENAI_CODEX_FAST_MODE_MAX_SESSION_ID_LENGTH, } from "./fast-mode.js";
export { OPENAI_CODEX_FAST_MODE_PATH } from "./fast-mode-paths.js";
export { loginOpenAICodex, logoutOpenAICodex, openAICodexAuthStatus, } from "./auth.js";
export { OpenAICodexCredentialStore, OPENAI_CODEX_AUTH_FILENAME, OPENAI_CODEX_PROVIDER, openAICodexAuthPath, } from "./store.js";
export { DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE, DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_CODEX_SEARCH_MODE, DEFAULT_OPENAI_CODEX_SEARCH_MODEL, mapOpenAICodexSearchResponse, OpenAICodexSearchProvider, OPENAI_CODEX_BASE_URL, OPENAI_CODEX_SEARCH_PROVIDER, OPENAI_CODEX_SEARCH_URL, } from "./search.js";
/** Stable Cordis plugin name. */
export const name = "llm-openai-codex";
/** LLM and web registries required before the composite provider can register. */
export const inject = ["llm", "web"];
export const Config = z.object({
    models: z.union([z.const(undefined), z.array(z.string())]),
    contextWindow: z.union([
        z.const(undefined),
        z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
    ]),
    overrideSparkContextWindow: z.boolean().default(false),
    searchModel: z.string().default(DEFAULT_OPENAI_CODEX_SEARCH_MODEL),
    searchMode: z
        .union(["cached", "indexed", "live"])
        .default(DEFAULT_OPENAI_CODEX_SEARCH_MODE),
    searchContextSize: z
        .union(["low", "medium", "high"])
        .default(DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE),
    searchMaxOutputTokens: z
        .number()
        .step(1)
        .min(1)
        .default(DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS),
    modifyReadImage: z.boolean().default(true),
    shareImagegenWithOtherModels: z.boolean().default(true),
    useWebSocketContextReuse: z.boolean().default(false),
    useNativeCompaction: z.boolean().default(false),
    fastModeDefault: z.boolean().default(false),
    proxyMode: z
        .union(["off", "scoped", "global"])
        .default(DEFAULT_PROXY_PREFERENCES.proxyMode),
    proxyUrl: z.string().default(DEFAULT_PROXY_PREFERENCES.proxyUrl),
});
/**
 * Register the `openai-codex` LLM route and standalone web-search provider
 * with one provider-native OAuth credential store.
 * @param ctx - plugin context carrying the LLM and web registries plus optional agent and attachment services.
 * @param config - standalone-search model, access mode, context size, and output budget.
 */
export function apply(ctx, config) {
    installOpenAICodexSearchEvent();
    const service = new OpenAICodexService({
        ...(config.models === undefined ? {} : { models: config.models }),
        contextWindow: config.contextWindow ?? null,
        overrideSparkContextWindow: config.overrideSparkContextWindow ?? false,
        modelCatalog: openAICodexModelCatalog(),
        modifyReadImage: config.modifyReadImage ?? true,
        shareImagegenWithOtherModels: config.shareImagegenWithOtherModels ?? true,
        useWebSocketContextReuse: config.useWebSocketContextReuse ?? false,
        useNativeCompaction: config.useNativeCompaction ?? false,
        fastModeDefault: config.fastModeDefault ?? false,
        proxyMode: config.proxyMode ?? DEFAULT_PROXY_PREFERENCES.proxyMode,
        proxyUrl: config.proxyUrl ?? DEFAULT_PROXY_PREFERENCES.proxyUrl,
    });
    const credentials = service.credentials;
    const imageTools = service.policy;
    const fastMode = new FastModeRegistry();
    assertNoOpenAICodexProviderConflict(ctx.llm.listProviders().map((provider) => provider.id));
    ctx.provide("openAICodex", service);
    ctx.effect(() => async () => {
        await service.dispose();
    }, "dsh-openai-codex: proxy transport");
    // Unconditional: the preference document is this provider's own file, not a
    // settings namespace the active profile may or may not serve.
    service.attachSettings(ctx);
    ctx.llm.registerAdapter([OPENAI_CODEX_PROVIDER], createOpenAICodexAdapter(credentials, () => ctx.get("attachments"), () => imageTools.responseApiSnapshot(), fastMode, () => imageTools.modelCatalogSnapshot().models, () => imageTools.contextWindowSnapshot().contextWindow, () => imageTools.contextWindowSnapshot().overrideSparkContextWindow, service.proxy.fetch, () => imageTools.fastModeSnapshot().fastModeDefault, () => imageTools.modelCatalogSnapshot().imageModels));
    ctx.web.registerSearchProvider(new OpenAICodexSearchProvider({
        credentials,
        fetch: service.proxy.fetch,
        model: config.searchModel ?? DEFAULT_OPENAI_CODEX_SEARCH_MODEL,
        mode: config.searchMode ?? DEFAULT_OPENAI_CODEX_SEARCH_MODE,
        contextSize: config.searchContextSize ?? DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE,
        maxOutputTokens: config.searchMaxOutputTokens ??
            DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS,
        resolveRequestId: () => String(ctx.get("agents")?.currentInitiator()?.session.id ?? randomUUID()),
        recordRequest: (request) => {
            recordOpenAICodexSearchRequest(ctx, request);
        },
    }));
    ctx.inject(["webServer"], (webCtx) => registerOpenAICodexAuthRoutes(webCtx, credentials, undefined, fastMode, imageTools, service, service.proxy.fetch, () => service.proxy.apply()));
    ctx.inject(["tools", "fs", "attachments"], (toolCtx) => {
        toolCtx.tools.register(imagegenTool(toolCtx, credentials, imageTools, service.proxy.fetch));
    });
    ctx.inject(["tools", "fs", "attachments", "agents"], (toolCtx) => {
        installReadImageEnhancement(toolCtx, imageTools);
    });
}
//# sourceMappingURL=index.js.map