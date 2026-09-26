/** Shared host service consumed by optional OpenAI Codex front-door adapters. */
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { Context } from "@deepseek-ai/cordis";
import type { OpenAICodexAuthStatus } from "./auth.js";
import { OpenAICodexCredentialStore } from "./store.js";
import { OpenAICodexProxyTransport } from "./proxy.js";
import type { ProxyPreferences } from "./proxy.js";
import { ImageToolPolicy } from "./tool-policy.js";
import type { ContextWindowPreferences, FastModePreferences, ImageToolPreferences, ModelCatalogEntry, ModelCatalogSettings, ResponseApiPreferences } from "./tool-policy.js";
import type { OpenAICodexUsage } from "./usage.js";
declare module "@deepseek-ai/cordis" {
    interface Context {
        /** Provider-owned account and preference service for optional front doors. */
        openAICodex: OpenAICodexService;
    }
}
/** Initial settings contributed by the bundle configuration. */
export interface OpenAICodexServiceOptions extends ImageToolPreferences, ResponseApiPreferences, ContextWindowPreferences, FastModePreferences, ProxyPreferences {
    models?: string[];
    modelCatalog: readonly ModelCatalogEntry[];
}
/**
 * One provider-owned host service shared by Web routes and terminal adapters.
 * Credentials and live policy stay singletons even when several front doors are mounted.
 */
export declare class OpenAICodexService {
    readonly credentials: OpenAICodexCredentialStore;
    readonly policy: ImageToolPolicy;
    readonly proxy: OpenAICodexProxyTransport;
    private readonly stopProxyWatch;
    constructor(options: OpenAICodexServiceOptions);
    /**
     * Adopt the durable preference document.
     *
     * The document is this provider's own file under the Harness home; the
     * settings seam owns the provider's *configuration* (and no longer exposes
     * per-plugin namespaces anyway), while these values are written by the
     * provider's own routes.
     */
    attachSettings(ctx: Context): void;
    /** Start the provider-native OAuth lifecycle. */
    login(interaction: AuthInteraction): Promise<void>;
    /** Remove this plugin's credential without touching Codex CLI/Desktop. */
    logout(): Promise<void>;
    /** Read non-secret authentication metadata. */
    authStatus(): Promise<OpenAICodexAuthStatus>;
    /** Read current subscription limits without issuing a model request. */
    usage(): Promise<OpenAICodexUsage>;
    imagePreferences(): ImageToolPreferences;
    updateImagePreferences(patch: Partial<ImageToolPreferences>): Promise<ImageToolPreferences>;
    responsePreferences(): ResponseApiPreferences;
    updateResponsePreferences(patch: Partial<ResponseApiPreferences>): Promise<ResponseApiPreferences>;
    contextWindowPreferences(): ContextWindowPreferences;
    updateContextWindowPreferences(patch: Partial<ContextWindowPreferences>): Promise<ContextWindowPreferences>;
    fastModePreferences(): FastModePreferences;
    updateFastModePreferences(patch: Partial<FastModePreferences>): Promise<FastModePreferences>;
    modelCatalogSettings(): ModelCatalogSettings;
    proxyPreferences(): ProxyPreferences;
    updateProxyPreferences(patch: Partial<ProxyPreferences>): Promise<ProxyPreferences>;
    dispose(): Promise<void>;
}
