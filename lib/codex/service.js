/** Shared host service consumed by optional OpenAI Codex front-door adapters. */
import { loginOpenAICodex, logoutOpenAICodex, openAICodexAuthStatus, } from "./auth.js";
import { OpenAICodexCredentialStore } from "./store.js";
import { OpenAICodexProxyTransport } from "./proxy.js";
import { ImageToolPolicy } from "./tool-policy.js";
import { readOpenAICodexRateLimits } from "./usage.js";
/**
 * One provider-owned host service shared by Web routes and terminal adapters.
 * Credentials and live policy stay singletons even when several front doors are mounted.
 */
export class OpenAICodexService {
    credentials = new OpenAICodexCredentialStore();
    policy;
    proxy;
    stopProxyWatch;
    constructor(options) {
        this.policy = new ImageToolPolicy(options, options.modelCatalog);
        this.proxy = new OpenAICodexProxyTransport(() => this.policy.proxySnapshot());
        void this.proxy.apply().catch((error) => {
            process.stderr.write(`[dsh-codex] failed to apply proxy settings: ${error instanceof Error ? error.message : String(error)}\n`);
        });
        this.stopProxyWatch = this.policy.watchProxyPreferences(() => {
            void this.proxy.apply().catch((error) => {
                process.stderr.write(`[dsh-codex] failed to apply proxy settings: ${error instanceof Error ? error.message : String(error)}\n`);
            });
        });
    }
    /**
     * Adopt the durable preference document.
     *
     * The document is this provider's own file under the Harness home; the
     * settings seam owns the provider's *configuration* (and no longer exposes
     * per-plugin namespaces anyway), while these values are written by the
     * provider's own routes.
     */
    attachSettings(ctx) {
        this.policy.attach(ctx);
    }
    /** Start the provider-native OAuth lifecycle. */
    async login(interaction) {
        await this.proxy.apply();
        return await loginOpenAICodex(interaction, this.credentials);
    }
    /** Remove this plugin's credential without touching Codex CLI/Desktop. */
    logout() {
        return logoutOpenAICodex(this.credentials);
    }
    /** Read non-secret authentication metadata. */
    authStatus() {
        return openAICodexAuthStatus(this.credentials);
    }
    /** Read current subscription limits without issuing a model request. */
    usage() {
        return readOpenAICodexRateLimits(this.credentials, this.proxy.fetch);
    }
    imagePreferences() {
        return this.policy.snapshot();
    }
    updateImagePreferences(patch) {
        return this.policy.update(patch);
    }
    responsePreferences() {
        return this.policy.responseApiSnapshot();
    }
    updateResponsePreferences(patch) {
        return this.policy.updateResponseApi(patch);
    }
    contextWindowPreferences() {
        return this.policy.contextWindowSnapshot();
    }
    updateContextWindowPreferences(patch) {
        return this.policy.updateContextWindow(patch);
    }
    fastModePreferences() {
        return this.policy.fastModeSnapshot();
    }
    updateFastModePreferences(patch) {
        return this.policy.updateFastMode(patch);
    }
    modelCatalogSettings() {
        return this.policy.modelCatalogSnapshot();
    }
    proxyPreferences() {
        return this.policy.proxySnapshot();
    }
    async updateProxyPreferences(patch) {
        const preferences = await this.policy.updateProxy(patch);
        await this.proxy.apply();
        return preferences;
    }
    async dispose() {
        this.stopProxyWatch();
        await this.proxy.dispose();
    }
}
//# sourceMappingURL=service.js.map