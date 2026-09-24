/**
 * Small shared helpers for the provider adapters: bounded HTTP, tolerant JSON
 * shape probes, and percent/date normalization.
 *
 * Every adapter is defensive by contract — a provider that changes shape or
 * goes offline must degrade to a typed error row, never take down the
 * collector or the sidebar.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/util
 */
import type { ProviderId, QuotaWindow, WindowKind } from '../contract.js';
/** Per-request ceiling for a provider read; keeps one slow vendor off the path. */
export declare const PROVIDER_TIMEOUT_MS = 15000;
/**
 * Host-side dependencies every adapter is handed. Keeping this a narrow
 * interface (rather than a cordis Context) is what lets each adapter be read
 * and tested on its own.
 */
export interface ProviderContext {
    /**
     * Resolve a credential reference to its value, or undefined when unset.
     * Resolution is per call by contract — a rotated key reaches the next read
     * without a restart.
     */
    credential(ref: string): Promise<string | undefined>;
    /** Absolute path of the DSH home directory (`~/.dsh`). */
    home: string;
    /** The plugin's own logger for non-fatal diagnostics. */
    warn(provider: ProviderId, message: string): void;
}
/** Whether an unknown value is a plain JSON object. */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** Read a finite number at `key`, or undefined. */
export declare function num(source: Record<string, unknown>, key: string): number | undefined;
/** Read a non-blank string at `key`, or undefined. */
export declare function str(source: Record<string, unknown>, key: string): string | undefined;
/** Clamp a percentage into 0-100, rounding to one decimal for display stability. */
export declare function clampPercent(value: number): number;
/**
 * Convert a remaining-percent reading into the consumed share the UI meters.
 * Providers report one or the other; the adapter edge is the only place that
 * knows which, so the translation stops here.
 */
export declare function usedFromRemaining(remainingPercent: number): number;
/**
 * Normalize a provider timestamp into ISO. Accepts epoch seconds, epoch
 * milliseconds, and RFC3339 strings, because the vendors disagree.
 * @returns ISO string, or undefined when the value cannot be read as a time.
 */
export declare function toIso(value: unknown): string | undefined;
/**
 * Build one window row, dropping absent optional fields so the wire payload
 * stays free of explicit nulls.
 * @param base - required window identity.
 * @param extras - optional metering fields, each dropped when undefined.
 * @returns the assembled window.
 */
export declare function windowOf(base: {
    id: string;
    label: string;
    kind: WindowKind;
}, extras: {
    usedPercent?: number | undefined;
    resetAt?: string | undefined;
    detail?: string | undefined;
}): QuotaWindow;
/**
 * `fetch` with a hard deadline, JSON decoding, and a status check.
 * @param url - absolute request URL.
 * @param init - request init; `signal` is supplied by this helper.
 * @param timeoutMs - deadline in milliseconds.
 * @returns the decoded JSON body.
 * @throws when the transport fails, the deadline expires, the status is not
 *   ok, or the body is not JSON.
 */
export declare function fetchJson(url: string, init: RequestInit, timeoutMs?: number): Promise<unknown>;
/**
 * A short, non-secret reason for a failed provider read. Token-shaped content
 * is stripped so an upstream error body can never leak a credential into the
 * browser, the settings document, or the logs.
 * @param error - the thrown value.
 * @returns a bounded human-readable message.
 */
export declare function reasonOf(error: unknown): string;
