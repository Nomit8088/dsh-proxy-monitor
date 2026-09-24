/**
 * The quota collector: one cached snapshot of every configured provider.
 *
 * Design notes:
 *
 * - **One slow vendor must not stall the others.** Providers are read
 *   concurrently and each failure is isolated to its own row; the snapshot
 *   always completes.
 * - **Reads are cheap but not free.** Upstream endpoints are rate-limited
 *   (Anthropic's usage endpoint in particular), so a snapshot is reused for
 *   `intervalMs` and concurrent callers share one in-flight read rather than
 *   stampeding the vendors.
 * - **Refresh is explicit.** `refresh()` forces a re-read (the sidebar's
 *   refresh action); `snapshot()` serves the cache and kicks a background
 *   read only when the entry has aged out.
 *
 * @module @dsh-external/dsh-proxy-monitor/collector
 */
import type { ProviderId, ProviderQuota, QuotaSnapshot } from './contract.js';
import { type ProviderContext } from './providers/util.js';
/** Options one collector is constructed with. */
export interface CollectorOptions {
    /** Host-provided provider dependencies. */
    context: ProviderContext;
    /** Origin of this DSH web server, used to reach sibling plugins' routes. */
    pluginBase: string;
    /** How long a snapshot stays fresh, in milliseconds. */
    intervalMs: number;
    /** Non-fatal diagnostic sink. */
    warn(message: string): void;
    /**
     * Per-provider replacements for the default reader table.
     *
     * A provider whose credential has a richer owner — one that refreshes tokens
     * and holds the cross-process writer lock — must be read through that owner
     * rather than through the standalone file reader in `providers/`. Two readers
     * of one credential is how a red rail and a green settings panel happen at the
     * same moment: the standalone reader sees an expired token that the owner
     * would already have refreshed.
     *
     * Keyed by provider id and applied *after* the default table, so an override
     * never has to re-declare a provider's position in the display order.
     */
    overrides?: Partial<Record<ProviderId, (context: ProviderContext, pluginBase: string) => Promise<ProviderQuota>>>;
}
/** The providers this collector can read, in display order. */
export declare const PROVIDER_ORDER: readonly ProviderId[];
/** The quota collector; one instance per Host plugin fiber. */
export declare class QuotaCollector {
    private readonly options;
    private cached;
    /** The in-flight read, so concurrent callers join it instead of duplicating it. */
    private inflight;
    /** Set once the owning fiber is disposed; stops late reads from publishing. */
    private disposed;
    constructor(options: CollectorOptions);
    /**
     * Repoint the sibling-plugin origin, e.g. after the web server binds or the
     * settings document changes. The cache is dropped because rows read through
     * the previous origin may have been answered by a server that has moved.
     * @param pluginBase - fresh origin, e.g. `http://127.0.0.1:3080`.
     */
    setPluginBase(pluginBase: string): void;
    /**
     * Change the freshness window. The cache is dropped so a shortened interval
     * takes effect on the next read rather than after the old window expires.
     * @param intervalMs - new freshness window in milliseconds.
     */
    setInterval(intervalMs: number): void;
    /**
     * The current snapshot without forcing an upstream read.
     * @returns the cached snapshot, or a fresh one when the cache is empty.
     */
    snapshot(): Promise<QuotaSnapshot>;
    /**
     * Force a re-read of every provider.
     * @returns the fresh snapshot.
     */
    refresh(): Promise<QuotaSnapshot>;
    /**
     * Read every provider concurrently and publish the result.
     *
     * Concurrent callers join one in-flight read: a burst of browser tabs, or a
     * timer tick landing beside a manual refresh, must not multiply upstream
     * requests against rate-limited vendor endpoints.
     *
     * @returns the fresh snapshot.
     */
    private read;
    /** Run every reader and assemble the snapshot. Never throws. */
    private collect;
    /** Release the cache and stop publishing results from in-flight reads. */
    dispose(): void;
}
