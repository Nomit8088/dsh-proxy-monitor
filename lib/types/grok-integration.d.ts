/**
 * Grok LLM adapter + live model catalog routes for dsh-proxy-monitor.
 */
import type { Context } from '@deepseek-ai/cordis';
import { GrokModelCatalog } from './grok/grok-models.js';
import { GrokModelSettingsStore } from './grok/model-settings.js';
import type { GrokAuthService } from './grok/grok-auth-service.js';
export declare const GROK_MODELS_PATH = "/plugins/dsh-proxy-monitor/grok/models";
/** Register the Grok adapter (when free) and the live catalog HTTP surface. */
export declare function setupGrok(ctx: Context, grokService: GrokAuthService): {
    modelSettings: GrokModelSettingsStore;
    catalog: GrokModelCatalog;
};
