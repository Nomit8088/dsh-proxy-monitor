/** Explicit proxy modes for OpenAI Codex HTTP traffic. */
import { EnvHttpProxyAgent, fetch as undiciFetch, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher, } from "undici";
export const DEFAULT_PROXY_PREFERENCES = {
    proxyMode: "off",
    proxyUrl: "",
};
function invalidProxyUrl() {
    return new Error("Proxy URL must use http:// or https://");
}
/** Validate a persisted proxy value without echoing possible credentials. */
export function normalizeProxyUrl(value) {
    const trimmed = value.trim();
    if (trimmed.length === 0)
        return "";
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        throw invalidProxyUrl();
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.hostname.length === 0) {
        throw invalidProxyUrl();
    }
    return trimmed;
}
function configuredProxyUrl(proxyUrl) {
    const explicit = normalizeProxyUrl(proxyUrl);
    if (explicit.length > 0)
        return explicit;
    const pluginEnvironment = process.env.DSH_CODEX_PROXY?.trim() ?? "";
    return pluginEnvironment.length > 0
        ? normalizeProxyUrl(pluginEnvironment)
        : "";
}
function environmentProxyKey() {
    return [
        process.env.DSH_CODEX_PROXY,
        process.env.https_proxy,
        process.env.HTTPS_PROXY,
        process.env.http_proxy,
        process.env.HTTP_PROXY,
        process.env.all_proxy,
        process.env.ALL_PROXY,
        process.env.no_proxy,
        process.env.NO_PROXY,
    ]
        .map((value) => value?.trim() ?? "")
        .join("\u0000");
}
function proxyKey(proxyUrl) {
    const explicit = configuredProxyUrl(proxyUrl);
    return explicit.length === 0
        ? `env:${environmentProxyKey()}`
        : `url:${explicit}`;
}
function createScopedDispatcher(proxyUrl) {
    const explicit = configuredProxyUrl(proxyUrl);
    return explicit.length > 0
        ? new ProxyAgent(explicit)
        : new EnvHttpProxyAgent();
}
function createFallbackGlobalDispatcher(proxyUrl) {
    const explicit = configuredProxyUrl(proxyUrl);
    const inheritedNoProxy = process.env.no_proxy?.trim() || process.env.NO_PROXY?.trim();
    const noProxy = [
        inheritedNoProxy,
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
    ]
        .filter((value) => value !== undefined && value.length > 0)
        .join(",");
    return new EnvHttpProxyAgent({
        ...(explicit.length === 0
            ? {}
            : { httpProxy: explicit, httpsProxy: explicit }),
        noProxy,
    });
}
function globalProxyEnvironment(proxyUrl) {
    const explicit = configuredProxyUrl(proxyUrl);
    return {
        get(name) {
            const lower = name.toLowerCase();
            if (explicit.length > 0 &&
                (lower === "http_proxy" || lower === "https_proxy")) {
                return { value: explicit };
            }
            const value = process.env[name];
            return value === undefined ? undefined : { value };
        },
    };
}
const HARNESS_PROXY_MODULE = "@deepseek-ai/dsh-http-proxy";
function moduleIsUnavailable(error) {
    return (error instanceof Error &&
        "code" in error &&
        error.code === "ERR_MODULE_NOT_FOUND" &&
        error.message.includes(HARNESS_PROXY_MODULE));
}
async function installFallbackGlobalProxy(proxyUrl) {
    const previous = getGlobalDispatcher();
    const dispatcher = createFallbackGlobalDispatcher(proxyUrl);
    setGlobalDispatcher(dispatcher);
    return async () => {
        if (getGlobalDispatcher() === dispatcher) {
            setGlobalDispatcher(previous);
        }
        await dispatcher.close();
    };
}
async function installHarnessGlobalProxy(proxyUrl) {
    let loaded;
    try {
        // DSH 0.1.3 owns this process-wide policy. Keep the import optional while
        // the plugin still supports the published 0.1.1 line that predates it.
        loaded = (await import(HARNESS_PROXY_MODULE));
    }
    catch (error) {
        if (!moduleIsUnavailable(error))
            throw error;
        return await installFallbackGlobalProxy(proxyUrl);
    }
    if (loaded.installProxyFromEnvironment === undefined) {
        return await installFallbackGlobalProxy(proxyUrl);
    }
    return await loaded.installProxyFromEnvironment(globalProxyEnvironment(proxyUrl), (message) => {
        process.stderr.write(`[dsh-codex] ${message}\n`);
    });
}
/**
 * Owns request-scoped dispatch and an optional nested Harness-wide policy.
 * Disposing the nested policy restores the launcher's original proxy policy.
 */
export class OpenAICodexProxyTransport {
    preferences;
    dispatchers = new Map();
    globalDispose;
    appliedGlobalKey;
    transition = Promise.resolve();
    disposed = false;
    constructor(preferences) {
        this.preferences = preferences;
    }
    /** Reconcile process-global state after a live setting change. */
    apply() {
        const preferences = this.preferences();
        normalizeProxyUrl(preferences.proxyUrl);
        const desiredKey = preferences.proxyMode === "global"
            ? proxyKey(preferences.proxyUrl)
            : undefined;
        this.transition = this.transition.catch(() => undefined).then(async () => {
            if (this.disposed || desiredKey === this.appliedGlobalKey)
                return;
            await this.restoreGlobal();
            if (desiredKey === undefined)
                return;
            this.globalDispose = await installHarnessGlobalProxy(preferences.proxyUrl);
            this.appliedGlobalKey = desiredKey;
        });
        return this.transition;
    }
    /** Fetch implementation injected into Codex-owned HTTP call sites. */
    fetch = async (input, init) => {
        await this.apply();
        const preferences = this.preferences();
        if (preferences.proxyMode !== "scoped") {
            return await globalThis.fetch(input, init);
        }
        const options = {
            ...(init ?? {}),
            dispatcher: this.dispatcher(preferences.proxyUrl),
        };
        return (await undiciFetch(input, options));
    };
    /** Restore host networking and close all provider-owned pools. */
    async dispose() {
        await this.transition.catch(() => undefined);
        this.disposed = true;
        await this.restoreGlobal();
        const dispatchers = [...this.dispatchers.values()];
        this.dispatchers.clear();
        await Promise.allSettled(dispatchers.map(async (dispatcher) => await dispatcher.close()));
    }
    dispatcher(proxyUrl) {
        const key = proxyKey(proxyUrl);
        let dispatcher = this.dispatchers.get(key);
        if (dispatcher === undefined) {
            dispatcher = createScopedDispatcher(proxyUrl);
            this.dispatchers.set(key, dispatcher);
        }
        return dispatcher;
    }
    async restoreGlobal() {
        const dispose = this.globalDispose;
        this.globalDispose = undefined;
        this.appliedGlobalKey = undefined;
        await dispose?.();
    }
}
//# sourceMappingURL=proxy.js.map