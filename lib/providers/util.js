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
/** Per-request ceiling for a provider read; keeps one slow vendor off the path. */
export const PROVIDER_TIMEOUT_MS = 15_000;
/** Whether an unknown value is a plain JSON object. */
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Read a finite number at `key`, or undefined. */
export function num(source, key) {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** Read a non-blank string at `key`, or undefined. */
export function str(source, key) {
    const value = source[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
/** Clamp a percentage into 0-100, rounding to one decimal for display stability. */
export function clampPercent(value) {
    const bounded = Math.min(100, Math.max(0, value));
    return Math.round(bounded * 10) / 10;
}
/**
 * Convert a remaining-percent reading into the consumed share the UI meters.
 * Providers report one or the other; the adapter edge is the only place that
 * knows which, so the translation stops here.
 */
export function usedFromRemaining(remainingPercent) {
    return clampPercent(100 - remainingPercent);
}
/**
 * Normalize a provider timestamp into ISO. Accepts epoch seconds, epoch
 * milliseconds, and RFC3339 strings, because the vendors disagree.
 * @returns ISO string, or undefined when the value cannot be read as a time.
 */
export function toIso(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        // Epoch seconds below this threshold (year ~2286 in ms) read as seconds.
        const ms = value < 1e11 ? value * 1000 : value;
        const date = new Date(ms);
        return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    }
    return undefined;
}
/**
 * Build one window row, dropping absent optional fields so the wire payload
 * stays free of explicit nulls.
 * @param base - required window identity.
 * @param extras - optional metering fields, each dropped when undefined.
 * @returns the assembled window.
 */
export function windowOf(base, extras) {
    return {
        ...base,
        ...(extras.usedPercent === undefined ? {} : { usedPercent: extras.usedPercent }),
        ...(extras.resetAt === undefined ? {} : { resetAt: extras.resetAt }),
        ...(extras.detail === undefined ? {} : { detail: extras.detail }),
    };
}
/**
 * `fetch` with a hard deadline, JSON decoding, and a status check.
 * @param url - absolute request URL.
 * @param init - request init; `signal` is supplied by this helper.
 * @param timeoutMs - deadline in milliseconds.
 * @returns the decoded JSON body.
 * @throws when the transport fails, the deadline expires, the status is not
 *   ok, or the body is not JSON.
 */
export async function fetchJson(url, init, timeoutMs = PROVIDER_TIMEOUT_MS) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)}`);
    }
    return await response.json();
}
/**
 * A short, non-secret reason for a failed provider read. Token-shaped content
 * is stripped so an upstream error body can never leak a credential into the
 * browser, the settings document, or the logs.
 * @param error - the thrown value.
 * @returns a bounded human-readable message.
 */
export function reasonOf(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted]')
        .replace(/(\b(?:code|token|refresh_token|access_token|api_?key)=)[^&\s]+/giu, '$1[redacted]')
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[redacted]')
        .slice(0, 200);
}
//# sourceMappingURL=util.js.map