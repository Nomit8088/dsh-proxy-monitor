/** Live ChatGPT Codex rate-limit usage for the browser account page. */
import type { OpenAICodexCredentialStore } from './store.js';
/** Fixed endpoint used by the official Codex client for ChatGPT rate limits. */
export declare const OPENAI_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
/** Stable public discriminant for an expired or revoked Codex OAuth session. */
export declare const OPENAI_CODEX_REAUTH_REQUIRED_CODE: "OPENAI_CODEX_REAUTH_REQUIRED";
/** Fixed, secret-free message for a browser-facing reauthorization prompt. */
export declare const OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE = "OpenAI Codex authorization must be renewed";
/**
 * Raised when the usage endpoint rejects the current OAuth session.
 *
 * The error intentionally carries no response, credential, or account data so
 * callers can safely pass its fixed message across the Web boundary.
 */
export declare class OpenAICodexReauthRequiredError extends Error {
    readonly code: "OPENAI_CODEX_REAUTH_REQUIRED";
    constructor();
}
/** Identify the dedicated reauthorization failure without comparing messages. */
export declare function isOpenAICodexReauthRequiredError(error: unknown): error is OpenAICodexReauthRequiredError;
/** One quota window expressed as remaining capacity for direct UI rendering. */
export interface OpenAICodexRateLimitWindow {
    /** Percent still available in this window. */
    readonly remainingPercent: number;
    /** Server-declared rolling-window length in seconds. */
    readonly windowSeconds: number;
    /** Server-declared reset time as Unix seconds, when supplied and valid. */
    readonly resetAt?: number;
}
/** One separately metered Codex quota bucket. */
export interface OpenAICodexRateLimit {
    /** Stable server feature id. */
    readonly id: string;
    /** Optional server-provided display name. */
    readonly name?: string;
    /** Available rolling windows for this bucket. */
    readonly windows: readonly OpenAICodexRateLimitWindow[];
}
/** Optional exact prepaid-credit balance returned by ChatGPT. */
export interface OpenAICodexCredits {
    /** Whether the balance is unmetered. */
    readonly unlimited: boolean;
    /** Exact provider-formatted balance when finite and disclosed. */
    readonly balance?: string;
}
/** Optional exact workspace member spend limit returned by ChatGPT. */
export interface OpenAICodexIndividualLimit {
    /** Exact configured limit. */
    readonly limit: string;
    /** Exact amount consumed. */
    readonly used: string;
    /** Exact amount still available. */
    readonly remaining: string;
    /** Percent still available for progress rendering. */
    readonly remainingPercent: number;
}
/** Secret-free quota projection returned to the browser. */
export interface OpenAICodexUsage {
    /** Rolling Codex rate-limit buckets. */
    readonly rateLimits: readonly OpenAICodexRateLimit[];
    /** Exact prepaid-credit balance when supported for this account. */
    readonly credits?: OpenAICodexCredits;
    /** Exact workspace member limit when supported for this account. */
    readonly individualLimit?: OpenAICodexIndividualLimit;
}
/**
 * Convert the provider response into the small secret-free object sent to the browser.
 * @param value - opaque JSON returned by the ChatGPT usage endpoint.
 * @returns core and additionally metered quota buckets with remaining percentages.
 */
export declare function parseOpenAICodexUsage(value: unknown): OpenAICodexUsage;
/**
 * Read current quota without issuing a model request. OAuth is refreshed through
 * the same provider-native credential lifecycle used by normal Codex turns.
 * @param store - plugin-owned OAuth credential store.
 * @returns current rate-limit buckets safe to expose to the local browser page.
 */
export declare function readOpenAICodexRateLimits(store: OpenAICodexCredentialStore, requestFetch?: typeof globalThis.fetch): Promise<OpenAICodexUsage>;
