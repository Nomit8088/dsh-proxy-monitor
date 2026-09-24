/**
 * Wire contract shared by the Host and browser halves of dsh-proxy-monitor.
 *
 * Everything here is JSON-safe and secret-free: the Host resolves credentials
 * and reaches the provider APIs, and only normalized quota numbers ever cross
 * the plugin-owned Connection RPC channel to the browser.
 *
 * @module @dsh-external/dsh-proxy-monitor/contract
 */

/** Logical Connection RPC channel owned by this plugin's Host half. */
export const PROXY_MONITOR_CHANNEL = '/proxy-monitor'

/** Durable settings namespace registered by the Host and read by the browser. */
export const PROXY_MONITOR_NAMESPACE = 'dsh-proxy-monitor'

/**
 * Stable provider ids. `claude` has no local credential in this environment
 * and is therefore reported as an explicit "not configured" row rather than
 * silently omitted — see `PROVIDERS` in the Host half.
 */
export type ProviderId = 'deepseek' | 'antigravity' | 'workbuddy' | 'codex' | 'grok' | 'claude'

/** How a quota window should be rendered. */
export type WindowKind = 'session' | 'weekly' | 'monthly' | 'balance' | 'credit' | 'other'

/**
 * One metered window or balance inside a provider.
 *
 * `usedPercent` is the single number the UI meters: it is always "how much of
 * this allowance is consumed", so 0 is a full tank and 100 is exhausted. A
 * provider that reports remaining instead is converted at the adapter edge,
 * never in the UI.
 */
export interface QuotaWindow {
  /** Stable id within the provider, unique per window. */
  id: string
  /** Short human label, e.g. "Current session" or "All models". */
  label: string
  /** Rendering class; the UI groups and orders by this. */
  kind: WindowKind
  /** Consumed share of the allowance, 0-100. Absent for balance-only rows. */
  usedPercent?: number
  /** ISO timestamp of the next reset, when the provider reports one. */
  resetAt?: string
  /** Free-form detail line, e.g. "5h window" or "$120.19 left". */
  detail?: string
}

/** How a provider's headline number should be read. */
export type ProviderStatus = 'ok' | 'unconfigured' | 'error'

/** One provider's current snapshot; the unit the sidebar renders. */
export interface ProviderQuota {
  id: ProviderId
  /** Display name, e.g. "Claude" or "DeepSeek". */
  name: string
  /** Plan or account label, when the provider exposes one. */
  plan?: string
  /** Account identity (email/nickname); never a token. */
  account?: string
  status: ProviderStatus
  /**
   * The headline percentage the ring meters: consumed share of the provider's
   * most binding allowance, 0-100. Absent when the provider is unconfigured,
   * errored, or only reports a balance.
   */
  usedPercent?: number
  /** Every metered window this provider reports, headline first. */
  windows: QuotaWindow[]
  /** Account balance rows (DeepSeek CNY, Codex credits) rendered as text. */
  balance?: string
  /** Why the provider could not be read; present exactly when status is not ok. */
  error?: string
  /** Epoch milliseconds this snapshot was produced. */
  fetchedAt: number
}

/** One provider read result as returned over RPC. */
export interface QuotaSnapshot {
  providers: ProviderQuota[]
  /** Epoch milliseconds the whole snapshot completed. */
  fetchedAt: number
}

/** Reply to one refresh request. */
export interface RefreshResult {
  snapshot: QuotaSnapshot
  /** Providers whose own refresh threw; the rest still refreshed. */
  failed: ProviderId[]
}

/**
 * Endpoints the browser may call on the plugin's Connection RPC channel.
 *
 * Listed as one union so the Host dispatcher and the browser caller cannot
 * drift: answering an endpoint not named here, or asking for one, is a type
 * error rather than a runtime 404.
 *
 * The four account endpoints arrived with the reverse-proxy merge. They are
 * separate from `snapshot`/`refresh` because they act on one provider's session
 * rather than on the whole snapshot — a login must be pollable without forcing
 * a quota re-read of every other provider.
 */
export type ProxyMonitorEndpoint =
  /** Read the cached quota snapshot, refreshing upstream only when stale. */
  | 'snapshot'
  /** Force a re-read of every provider's quota. */
  | 'refresh'
  /** Read every proxied provider's account state (identity facts only). */
  | 'accounts'
  /** Start a login for one provider; payload `{ id }`. */
  | 'login'
  /** Poll one login attempt; payload `{ id, ticketId }`. */
  | 'loginPoll'
  /** End one provider's session; payload `{ id }`. */
  | 'logout'
