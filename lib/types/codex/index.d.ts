/**
 * Optional OpenAI Codex subscription bundle with ChatGPT OAuth, Codex models,
 * standalone search, browser settings, and vision-aware image input.
 * @module dsh-codex
 */
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
export { READ_IMAGE_TOOL_NAME } from "./read-image-enhancement.js";
export { IMAGEGEN_TOOL_NAME, OPENAI_CODEX_IMAGE_EDITS_URL, OPENAI_CODEX_IMAGE_GENERATIONS_URL, OPENAI_CODEX_IMAGE_MODEL, OpenAICodexImageClient, } from "./imagegen.js";
export { DEFAULT_CONTEXT_WINDOW_PREFERENCES, DEFAULT_FAST_MODE_PREFERENCES, DEFAULT_IMAGE_TOOL_PREFERENCES, DEFAULT_RESPONSE_API_PREFERENCES, ImageToolPolicy, } from "./tool-policy.js";
export type { ContextWindowPreferences, FastModePreferences, ImageToolPreferences, ResponseApiPreferences, } from "./tool-policy.js";
export { isOpenAICodexReauthRequiredError, OPENAI_CODEX_REAUTH_REQUIRED_CODE, OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE, OPENAI_CODEX_USAGE_URL, OpenAICodexReauthRequiredError, parseOpenAICodexUsage, readOpenAICodexRateLimits, } from "./usage.js";
export type { OpenAICodexCredits, OpenAICodexIndividualLimit, OpenAICodexRateLimit, OpenAICodexRateLimitWindow, OpenAICodexUsage, } from "./usage.js";
export { installOpenAICodexSearchEvent, OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT, recordOpenAICodexSearchRequest, } from "./search-event.js";
import type { OpenAICodexSearchContextSize, OpenAICodexSearchMode } from "./search.js";
import type { OpenAICodexProxyMode } from "./proxy.js";
export { OpenAICodexService } from "./service.js";
export type { OpenAICodexServiceOptions } from "./service.js";
export { DEFAULT_PROXY_PREFERENCES, normalizeProxyUrl, OpenAICodexProxyTransport, } from "./proxy.js";
export type { OpenAICodexProxyMode, ProxyPreferences } from "./proxy.js";
export { assertNoOpenAICodexProviderConflict, diagnoseOpenAICodex, openAICodexConflictMessage, } from "./doctor.js";
export type { OpenAICodexDiagnosticOptions, OpenAICodexDiagnosticReport, } from "./doctor.js";
export { FastModeRegistry, isFastModeSessionId, OPENAI_CODEX_FAST_MODE_MAX_SESSIONS, OPENAI_CODEX_FAST_MODE_MAX_SESSION_ID_LENGTH, } from "./fast-mode.js";
export { OPENAI_CODEX_FAST_MODE_PATH } from "./fast-mode-paths.js";
export { loginOpenAICodex, logoutOpenAICodex, openAICodexAuthStatus, } from "./auth.js";
export type { OpenAICodexAuthStatus } from "./auth.js";
export { OpenAICodexCredentialStore, OPENAI_CODEX_AUTH_FILENAME, OPENAI_CODEX_PROVIDER, openAICodexAuthPath, } from "./store.js";
export { DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE, DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_CODEX_SEARCH_MODE, DEFAULT_OPENAI_CODEX_SEARCH_MODEL, mapOpenAICodexSearchResponse, OpenAICodexSearchProvider, OPENAI_CODEX_BASE_URL, OPENAI_CODEX_SEARCH_PROVIDER, OPENAI_CODEX_SEARCH_URL, } from "./search.js";
export type { OpenAICodexSearchContextSize, OpenAICodexSearchMode, OpenAICodexSearchProviderOptions, OpenAICodexSearchRequestRecord, } from "./search.js";
/** Stable Cordis plugin name. */
export declare const name = "llm-openai-codex";
/** LLM and web registries required before the composite provider can register. */
export declare const inject: string[];
/** Composite model and standalone-search configuration. */
export interface Config {
    /** Model ids advertised by the provider; omitted to advertise the full catalog. */
    models?: string[] | undefined;
    /** Client-side model context capacity in tokens; omitted to keep provider defaults. */
    contextWindow?: number | undefined;
    /** Apply the context-window override to GPT-5.3 Codex Spark as well. */
    overrideSparkContextWindow?: boolean;
    /** Model used for auxiliary standalone searches. */
    searchModel?: string;
    /** Cached, indexed, or live web access. */
    searchMode?: OpenAICodexSearchMode;
    /** Amount of search context returned by the provider. */
    searchContextSize?: OpenAICodexSearchContextSize;
    /** Maximum generated tokens returned by the standalone search endpoint. */
    searchMaxOutputTokens?: number;
    /** Extend Harness read_image with HTTP(S) URL input. */
    modifyReadImage?: boolean;
    /** Allow non-Codex vision models to call imagegen. */
    shareImagegenWithOtherModels?: boolean;
    /** Reuse matching Codex context through the session's WebSocket connection. */
    useWebSocketContextReuse?: boolean;
    /** Use Codex V2 Responses compaction for Harness compaction calls. */
    useNativeCompaction?: boolean;
    /** Force the priority service tier on every Codex session. */
    fastModeDefault?: boolean;
    /** How this plugin applies its proxy URL. */
    proxyMode?: OpenAICodexProxyMode;
    /** HTTP(S) proxy URL; empty uses the launch environment. */
    proxyUrl?: string;
}
export declare const Config: z<Config>;
/**
 * Register the `openai-codex` LLM route and standalone web-search provider
 * with one provider-native OAuth credential store.
 * @param ctx - plugin context carrying the LLM and web registries plus optional agent and attachment services.
 * @param config - standalone-search model, access mode, context size, and output budget.
 */
export declare function apply(ctx: Context, config: Config): void;
