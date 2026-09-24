/**
 * Antigravity integration into dsh-proxy-monitor.
 *
 * Re-uses antigravity's AntigravityAdapter and registers LLM route if not already claimed,
 * and exposes web endpoints (/antigravity/api/...) for models/settings if needed.
 */
import type { Context } from '@deepseek-ai/cordis';
import { FileCredentialStore, FileModelSettingsStore } from './antigravity/index.js';
export declare function setupAntigravity(ctx: Context): {
    store: FileCredentialStore;
    modelSettings: FileModelSettingsStore;
};
