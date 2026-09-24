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

import type { ProviderId, ProviderQuota, QuotaSnapshot } from './contract.js'
import { readAntigravity } from './providers/antigravity.js'
import { readClaude } from './providers/claude.js'
import { readCodex } from './providers/codex.js'
import { readDeepSeek } from './providers/deepseek.js'
import { readGrok } from './providers/grok.js'
import { readWorkBuddy } from './providers/workbuddy.js'
import { reasonOf, type ProviderContext } from './providers/util.js'

/** Options one collector is constructed with. */
export interface CollectorOptions {
  /** Host-provided provider dependencies. */
  context: ProviderContext
  /** Origin of this DSH web server, used to reach sibling plugins' routes. */
  pluginBase: string
  /** How long a snapshot stays fresh, in milliseconds. */
  intervalMs: number
  /** Non-fatal diagnostic sink. */
  warn(message: string): void
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
  overrides?: Partial<Record<ProviderId, (context: ProviderContext, pluginBase: string) => Promise<ProviderQuota>>>
}
/** One provider reader: id plus the function that reads it. */
interface Reader {
  id: ProviderId
  read(context: ProviderContext, pluginBase: string): Promise<ProviderQuota>
}

/**
 * Every provider this plugin knows, in sidebar display order. All are read on
 * every pass; an unconfigured one answers a typed `unconfigured` row rather
 * than being skipped, so the settings page can list what signing in would add.
 */
const READERS: readonly Reader[] = [
  { id: 'deepseek', read: context => readDeepSeek(context) },
  { id: 'codex', read: (context, base) => readCodex(context, base) },
  { id: 'workbuddy', read: (context, base) => readWorkBuddy(context, base) },
  { id: 'antigravity', read: (context, base) => readAntigravity(context, base) },
  { id: 'grok', read: context => readGrok(context) },
  { id: 'claude', read: context => readClaude(context) },
]

/** The providers this collector can read, in display order. */
export const PROVIDER_ORDER: readonly ProviderId[] = READERS.map(reader => reader.id)

/**
 * The reader table for one collector, with caller overrides applied.
 *
 * Overriding by id rather than appending means the display order stays the
 * module's business: a caller swapping Grok's reader cannot accidentally move
 * Grok to the end of the rail.
 *
 * @param overrides - per-provider replacements, if any.
 * @returns the readers to run, in display order.
 */
function readersWith(
  overrides: CollectorOptions['overrides'],
): readonly Reader[] {
  if (overrides === undefined) return READERS
  return READERS.map(reader => {
    const replacement = overrides[reader.id]
    return replacement === undefined ? reader : { id: reader.id, read: replacement }
  })
}

/** One placeholder row for a provider whose reader threw outright. */
function failedRow(id: ProviderId, error: unknown): ProviderQuota {
  return {
    id,
    name: id,
    status: 'error',
    windows: [],
    error: reasonOf(error),
    fetchedAt: Date.now(),
  }
}

/** The quota collector; one instance per Host plugin fiber. */
export class QuotaCollector {
  private readonly options: CollectorOptions
  private cached: QuotaSnapshot | undefined
  /** The in-flight read, so concurrent callers join it instead of duplicating it. */
  private inflight: Promise<QuotaSnapshot> | undefined
  /** Set once the owning fiber is disposed; stops late reads from publishing. */
  private disposed = false

  constructor(options: CollectorOptions) {
    this.options = options
  }

  /**
   * Repoint the sibling-plugin origin, e.g. after the web server binds or the
   * settings document changes. The cache is dropped because rows read through
   * the previous origin may have been answered by a server that has moved.
   * @param pluginBase - fresh origin, e.g. `http://127.0.0.1:3080`.
   */
  setPluginBase(pluginBase: string): void {
    if (pluginBase === this.options.pluginBase) return
    this.options.pluginBase = pluginBase
    this.cached = undefined
  }

  /**
   * Change the freshness window. The cache is dropped so a shortened interval
   * takes effect on the next read rather than after the old window expires.
   * @param intervalMs - new freshness window in milliseconds.
   */
  setInterval(intervalMs: number): void {
    if (intervalMs === this.options.intervalMs) return
    this.options.intervalMs = intervalMs
    this.cached = undefined
  }

  /**
   * The current snapshot without forcing an upstream read.
   * @returns the cached snapshot, or a fresh one when the cache is empty.
   */
  async snapshot(): Promise<QuotaSnapshot> {
    const cached = this.cached
    if (cached !== undefined && Date.now() - cached.fetchedAt < this.options.intervalMs) {
      return cached
    }
    return await this.read()
  }

  /**
   * Force a re-read of every provider.
   * @returns the fresh snapshot.
   */
  async refresh(): Promise<QuotaSnapshot> {
    return await this.read()
  }

  /**
   * Read every provider concurrently and publish the result.
   *
   * Concurrent callers join one in-flight read: a burst of browser tabs, or a
   * timer tick landing beside a manual refresh, must not multiply upstream
   * requests against rate-limited vendor endpoints.
   *
   * @returns the fresh snapshot.
   */
  private async read(): Promise<QuotaSnapshot> {
    const existing = this.inflight
    if (existing !== undefined) return await existing

    const flight = this.collect()
    this.inflight = flight
    try {
      const snapshot = await flight
      // A read that outlives its fiber must not resurrect the cache.
      if (!this.disposed) this.cached = snapshot
      return snapshot
    } finally {
      this.inflight = undefined
    }
  }

  /** Run every reader and assemble the snapshot. Never throws. */
  private async collect(): Promise<QuotaSnapshot> {
    const { context, pluginBase } = this.options
    const settled = await Promise.all(
      readersWith(this.options.overrides).map(async reader => {
        try {
          return await reader.read(context, pluginBase)
        } catch (error) {
          // A reader is defensive by contract, so reaching here means a bug in
          // one adapter; it degrades to one error row, not a failed snapshot.
          this.options.warn(`provider ${reader.id} reader threw: ${reasonOf(error)}`)
          return failedRow(reader.id, error)
        }
      }),
    )
    return { providers: settled, fetchedAt: Date.now() }
  }

  /** Release the cache and stop publishing results from in-flight reads. */
  dispose(): void {
    this.disposed = true
    this.cached = undefined
  }
}
