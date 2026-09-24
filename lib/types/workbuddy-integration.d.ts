/**
 * WorkBuddy integration into dsh-proxy-monitor (CN-only).
 *
 * Imports WorkBuddy's apply and config from src/workbuddy/index.js,
 * applies it to Context so the /plugins/dsh-workbuddy-connect/status endpoint
 * and the 'workbuddy' LLM route are fully active in this single plugin.
 */
import type { Context } from '@deepseek-ai/cordis';
import { WorkBuddyCredentialStore } from './workbuddy/index.js';
export declare function setupWorkBuddy(ctx: Context): {
    store: WorkBuddyCredentialStore;
};
