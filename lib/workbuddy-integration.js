/**
 * WorkBuddy integration into dsh-proxy-monitor (CN-only).
 *
 * Imports WorkBuddy's apply and config from src/workbuddy/index.js,
 * applies it to Context so the /plugins/dsh-workbuddy-connect/status endpoint
 * and the 'workbuddy' LLM route are fully active in this single plugin.
 */
import { apply as applyWorkBuddy, Config as WorkBuddyConfig, WORKBUDDY_PROVIDER, WorkBuddyCredentialStore, CN_VARIANT, } from './workbuddy/index.js';
import { overlayWorkBuddyAdapterModels, registerWorkBuddyCatalogApi } from './catalog-http.js';
import { wrapAdapterCatalog } from './llm-takeover.js';
import { patchWorkBuddyEncryptedAuth } from './workbuddy/patch-encrypted-auth.js';
export function setupWorkBuddy(ctx) {
    // WorkBuddy 5.6 encrypts desktop tokens; patch before apply() constructs stores.
    patchWorkBuddyEncryptedAuth();
    const store = new WorkBuddyCredentialStore({
        variant: CN_VARIANT,
        refresh: () => Promise.reject(new Error('refresh not needed')),
    });
    // Check if llm service already has workbuddy adapter registered
    ctx.inject(['llm'], (llmCtx) => {
        wrapAdapterCatalog(llmCtx.llm, WORKBUDDY_PROVIDER, {
            listModels: async (original, provider) => {
                const models = await original(provider);
                return overlayWorkBuddyAdapterModels(models);
            },
            resolveModel: async (original, provider, model, signal) => {
                const resolved = await original(provider, model, signal);
                const [overlaid] = await overlayWorkBuddyAdapterModels([resolved]);
                return overlaid ?? resolved;
            },
        }, ctx.logger);
    });
    // Apply WorkBuddy backend runtime (endpoints, sweep, catalog, etc.)
    try {
        const defaultConfig = WorkBuddyConfig({});
        applyWorkBuddy(ctx, defaultConfig);
    }
    catch (err) {
        ctx.logger.warn('dsh-proxy-monitor: workbuddy apply notice: %s', String(err));
    }
    // Own catalog URL — the leftover dsh-workbuddy-connect bundle never
    // registered /models, and apply() above may throw DUPLICATE_ADAPTER
    // before its inner inject runs.
    registerWorkBuddyCatalogApi(ctx);
    return {
        store,
    };
}
//# sourceMappingURL=workbuddy-integration.js.map