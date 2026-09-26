/**
 * Codex composite features: LLM route, standalone search, imagegen, read_image, auth routes.
 *
 * This module encapsulates all backend services ported from dsh-codex.
 * It is called from the main plugin entry point `src/index.ts`.
 */
import { randomUUID } from "node:crypto";
import { createOpenAICodexAdapter, openAICodexModelCatalog, } from "./codex/adapter.js";
import { registerOpenAICodexAuthRoutes, OpenAICodexWebAuth, } from "./codex/auth-routes.js";
import { installReadImageEnhancement } from "./codex/read-image-enhancement.js";
import { imagegenTool } from "./codex/imagegen.js";
import { FastModeRegistry } from "./codex/fast-mode.js";
import { installOpenAICodexSearchEvent, recordOpenAICodexSearchRequest, } from "./codex/search-event.js";
import { DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE, DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_CODEX_SEARCH_MODE, DEFAULT_OPENAI_CODEX_SEARCH_MODEL, OpenAICodexSearchProvider, } from "./codex/search.js";
import { OPENAI_CODEX_PROVIDER } from "./codex/store.js";
import { OpenAICodexService } from "./codex/service.js";
import { DEFAULT_PROXY_PREFERENCES } from "./codex/proxy.js";
import { installOrTakeOverAdapter } from "./llm-takeover.js";
import { CodexLiveModelCatalog } from "./codex/live-models.js";
import { createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
/**
 * Initialize Codex backend services and register routes/adapters.
 * If openai-codex is already registered (e.g. standalone dsh-codex plugin is active),
 * logs a notice and skips registering the LLM route and search provider to prevent conflicts.
 */
export function setupCodex(ctx, credentialsStore) {
    installOpenAICodexSearchEvent();
    const service = new OpenAICodexService({
        contextWindow: null,
        overrideSparkContextWindow: false,
        modelCatalog: openAICodexModelCatalog(),
        modifyReadImage: true,
        shareImagegenWithOtherModels: true,
        useWebSocketContextReuse: false,
        useNativeCompaction: false,
        fastModeDefault: false,
        proxyMode: DEFAULT_PROXY_PREFERENCES.proxyMode,
        proxyUrl: DEFAULT_PROXY_PREFERENCES.proxyUrl,
    });
    const credentials = credentialsStore ?? service.credentials;
    const imageTools = service.policy;
    const fastMode = new FastModeRegistry();
    const liveCatalog = new CodexLiveModelCatalog({
        resolveAuth: async () => {
            const models = createModels({ credentials });
            models.setProvider(openaiCodexProvider());
            const auth = await models.getAuth(OPENAI_CODEX_PROVIDER);
            const credential = await credentials.read(OPENAI_CODEX_PROVIDER);
            const access = auth?.auth.apiKey;
            const accountId = credential?.type === "oauth" ? credential.accountId : undefined;
            if (access === undefined || access.length === 0 || typeof accountId !== "string" || accountId.length === 0) {
                return undefined;
            }
            return { accessToken: access, accountId };
        },
        fetchImpl: service.proxy.fetch,
        warn: (message) => {
            ctx.logger.warn("dsh-proxy-monitor: %s", message);
        },
        onChange: () => {
            imageTools.adoptCatalog(openAICodexModelCatalog(liveCatalog));
            try {
                ctx.emit("llm/adapters-updated");
            }
            catch {
                /* best-effort */
            }
        },
    });
    // If standalone dsh-codex is active, openAICodex is already provided.
    // Only provide if not yet registered to avoid Cordis service collision.
    if (!ctx.get("openAICodex")) {
        try {
            ctx.provide("openAICodex", service);
        }
        catch {
            // ignore collision if already registered
        }
    }
    ctx.effect(() => async () => {
        await service.dispose();
    }, "dsh-proxy-monitor: codex proxy transport");
    // The preference document is this provider's own file, so it is adopted
    // unconditionally: an absent settings service no longer decides whether the
    // Codex page can remember anything (it used to gate the namespace
    // registration, and DSH 0.1.7 removed that seam entirely).
    service.attachSettings(ctx);
    // Check if LLM service is available and if openai-codex route is already claimed
    ctx.inject(["llm"], (llmCtx) => {
        const adapter = createOpenAICodexAdapter(credentials, () => ctx.get("attachments"), () => imageTools.responseApiSnapshot(), fastMode, () => imageTools.modelCatalogSnapshot().models, () => imageTools.contextWindowSnapshot().contextWindow, () => imageTools.contextWindowSnapshot().overrideSparkContextWindow, service.proxy.fetch, () => imageTools.fastModeSnapshot().fastModeDefault, () => imageTools.modelCatalogSnapshot().imageModels, liveCatalog);
        installOrTakeOverAdapter(llmCtx.llm, OPENAI_CODEX_PROVIDER, adapter, ctx.logger);
    });
    // Web search provider registration
    ctx.inject(["web"], (webCtx) => {
        webCtx.web.registerSearchProvider(new OpenAICodexSearchProvider({
            credentials,
            fetch: service.proxy.fetch,
            model: DEFAULT_OPENAI_CODEX_SEARCH_MODEL,
            mode: DEFAULT_OPENAI_CODEX_SEARCH_MODE,
            contextSize: DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE,
            maxOutputTokens: DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS,
            resolveRequestId: () => String(ctx.get("agents")?.currentInitiator()?.session.id ?? randomUUID()),
            recordRequest: (request) => {
                recordOpenAICodexSearchRequest(ctx, request);
            },
        }));
    });
    // Auth & preference web routes
    const webAuth = new OpenAICodexWebAuth(credentials, {
        requestFetch: service.proxy.fetch,
        beforeNetworkRequest: () => service.proxy.apply(),
    });
    ctx.inject(["webServer"], (webCtx) => {
        try {
            registerOpenAICodexAuthRoutes(webCtx, credentials, undefined, fastMode, imageTools, service, service.proxy.fetch, () => service.proxy.apply(), webAuth, async () => {
                await liveCatalog.refresh();
                return imageTools.adoptCatalog(openAICodexModelCatalog(liveCatalog));
            });
        }
        catch (error) {
            ctx.logger.warn("dsh-proxy-monitor: openai-codex auth routes already claimed: %s", String(error));
        }
    });
    // Independent catalog URL so leftover dsh-codex cannot 400 our refresh.
    ctx.inject(["webServer"], (webCtx) => {
        webCtx.effect(() => webCtx.webServer.register({
            kind: "exact",
            path: "/plugins/dsh-proxy-monitor/codex/models",
            handler: async (req, res) => {
                const send = (status, body) => {
                    res.writeHead(status, {
                        "content-type": "application/json; charset=utf-8",
                        "cache-control": "no-store",
                    });
                    res.end(JSON.stringify(body));
                };
                try {
                    if (req.method === "GET") {
                        return send(200, imageTools.modelCatalogSnapshot());
                    }
                    if (req.method !== "POST")
                        return send(405, { error: "method not allowed" });
                    const chunks = [];
                    for await (const chunk of req)
                        chunks.push(Buffer.from(chunk));
                    const body = chunks.length === 0
                        ? {}
                        : JSON.parse(Buffer.concat(chunks).toString("utf8"));
                    if (body["refresh"] === true) {
                        await liveCatalog.refresh();
                        const next = imageTools.adoptCatalog(openAICodexModelCatalog(liveCatalog));
                        try {
                            ctx.emit("llm/adapters-updated");
                        }
                        catch { /* best-effort */ }
                        return send(200, next);
                    }
                    const models = Array.isArray(body["models"]) ? body["models"] : undefined;
                    const imageModels = Array.isArray(body["imageModels"]) ? body["imageModels"] : undefined;
                    if (models === undefined && imageModels === undefined) {
                        return send(400, { error: "models or imageModels must be an array" });
                    }
                    const next = await imageTools.updateModelCatalog({
                        ...models === undefined ? {} : { models },
                        ...imageModels === undefined ? {} : { imageModels },
                    });
                    try {
                        ctx.emit("llm/adapters-updated");
                    }
                    catch { /* best-effort */ }
                    return send(200, next);
                }
                catch (error) {
                    return send(500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }), "dsh-proxy-monitor: codex live model catalog");
    });
    // Imagegen tool
    ctx.inject(["tools", "fs", "attachments"], (toolCtx) => {
        toolCtx.tools.register(imagegenTool(toolCtx, credentials, imageTools, service.proxy.fetch));
    });
    // Enhanced read_image tool
    ctx.inject(["tools", "fs", "attachments", "agents"], (toolCtx) => {
        installReadImageEnhancement(toolCtx, imageTools);
    });
    return {
        service,
        credentials,
        webAuth,
        fastMode,
        imageTools,
    };
}
//# sourceMappingURL=codex-integration.js.map