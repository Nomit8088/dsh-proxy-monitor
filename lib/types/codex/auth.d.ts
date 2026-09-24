/**
 * OpenAI Codex OAuth orchestration shared by the plugin and standalone launcher.
 * @module dsh-codex/auth
 */
import type { AuthInteraction } from '@earendil-works/pi-ai';
import { OpenAICodexCredentialStore } from './store.js';
/** Non-secret login state shown by the launcher. */
export interface OpenAICodexAuthStatus {
    /** Whether a stored OAuth credential exists. */
    authenticated: boolean;
    /** Access-token expiry time; refresh is automatic on the next request. */
    expiresAt?: Date;
}
/**
 * Complete provider-native OAuth and persist the resulting credential.
 * @param interaction - terminal or UI callbacks for the provider flow.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 */
export declare function loginOpenAICodex(interaction: AuthInteraction, store?: OpenAICodexCredentialStore): Promise<void>;
/**
 * Remove the stored OpenAI Codex credential.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 */
export declare function logoutOpenAICodex(store?: OpenAICodexCredentialStore): Promise<void>;
/**
 * Read non-secret OpenAI Codex login state without refreshing the token.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 * @returns stored login state and expiry.
 */
export declare function openAICodexAuthStatus(store?: OpenAICodexCredentialStore): Promise<OpenAICodexAuthStatus>;
