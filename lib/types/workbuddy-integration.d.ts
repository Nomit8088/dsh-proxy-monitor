/**
 * WorkBuddy integration into dsh-proxy-monitor (CN-only).
 *
 * Imports WorkBuddy's apply and config from src/workbuddy/index.js,
 * applies it to Context so the /plugins/dsh-workbuddy-connect/status endpoint
 * and the 'workbuddy' LLM route are fully active in this single plugin.
 */
import type { Context } from '@deepseek-ai/cordis';
import { WorkBuddyCredentialStore } from './workbuddy/index.js';
/**
 * The host's live WorkBuddy configuration.
 *
 * Thunks rather than values: the vendored runtime reads these fields from
 * long-lived closures (a probe's consent check, a credential store's desktop
 * path), and the Config references change in place when the settings page
 * writes, so a snapshot taken here would freeze the first value ever seen.
 */
export interface WorkBuddyLiveOptions {
    /** Explicit CN desktop auth-file path, or undefined for the app's own file. */
    authFile(): string | undefined;
    /** Explicit international desktop auth-file path, or undefined. */
    authFileAI(): string | undefined;
    /** Whether the user authorized reasoning-effort probes. */
    probeConsent(): boolean;
}
/** What the host half needs back from the vendored runtime. */
export interface WorkBuddyRuntime {
    /** Credential store the account face reads. */
    store: WorkBuddyCredentialStore;
    /** Re-point every variant's credential store after a settings change. */
    repoint(): void;
}
export declare function setupWorkBuddy(ctx: Context, live: WorkBuddyLiveOptions): WorkBuddyRuntime;
