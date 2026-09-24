/** Explicit proxy modes for OpenAI Codex HTTP traffic. */
export type OpenAICodexProxyMode = "off" | "scoped" | "global";
export interface ProxyPreferences {
    /** Whether this plugin leaves networking alone, proxies Codex only, or proxies the process. */
    proxyMode: OpenAICodexProxyMode;
    /** Explicit HTTP(S) proxy URL; empty uses standard proxy environment variables. */
    proxyUrl: string;
}
export declare const DEFAULT_PROXY_PREFERENCES: ProxyPreferences;
/** Validate a persisted proxy value without echoing possible credentials. */
export declare function normalizeProxyUrl(value: string): string;
/**
 * Owns request-scoped dispatch and an optional nested Harness-wide policy.
 * Disposing the nested policy restores the launcher's original proxy policy.
 */
export declare class OpenAICodexProxyTransport {
    private readonly preferences;
    private readonly dispatchers;
    private globalDispose;
    private appliedGlobalKey;
    private transition;
    private disposed;
    constructor(preferences: () => ProxyPreferences);
    /** Reconcile process-global state after a live setting change. */
    apply(): Promise<void>;
    /** Fetch implementation injected into Codex-owned HTTP call sites. */
    readonly fetch: typeof globalThis.fetch;
    /** Restore host networking and close all provider-owned pools. */
    dispose(): Promise<void>;
    private dispatcher;
    private restoreGlobal;
}
