/**
 * Wire contract shared by the Host and browser halves of dsh-proxy-monitor.
 *
 * Everything here is JSON-safe and secret-free: the Host resolves credentials
 * and reaches the provider APIs, and only normalized quota numbers ever cross
 * the plugin-owned Connection RPC channel to the browser.
 *
 * @module @dsh-external/dsh-proxy-monitor/contract
 */
/**
 * Browser-facing route carrying this plugin's own endpoints.
 *
 * These are exact Fetch routes on Connection's shared, authenticated `/api`
 * channel (`connection.fetch.register`), the same mechanism the shipped file
 * and upload routes use. Connection's per-plugin `rpc.handle(channel, …)` is
 * *not* usable in this DSH generation: its implementation registers the channel
 * through `owner.webServer`, and that access fails inside the service no matter
 * which services the caller injects, so no route is ever mounted (the browser
 * sees `HTTP 405`). A plugin-owned route on the shared channel gets the platform
 * Host/Origin fence and browser authentication for free, so the endpoints below
 * are reached with one ordinary same-origin POST each.
 */
export const PROXY_MONITOR_ROUTE = '/api/proxy-monitor';
/**
 * Loader entry id of this plugin, and with it the identity of its settings.
 *
 * The settings seam addresses editable configuration by the id of the profile
 * entry that owns it — one form per entry, projected from that entry's own
 * `.volatile()` Config fields. Both halves therefore bind to this one string:
 * the Host declares the schema, and the browser reads and writes the form of
 * this entry.
 */
export const PROXY_MONITOR_ENTRY = 'dsh-proxy-monitor';
/**
 * Every endpoint the browser may call on this plugin's route, in one tuple.
 *
 * The Host registers one exact route per member and the browser caller posts to
 * one member, so answering an endpoint not named here, or asking for one, is a
 * type error rather than a runtime 404.
 *
 * The four account endpoints arrived with the reverse-proxy merge. They are
 * separate from `snapshot`/`refresh` because they act on one provider's session
 * rather than on the whole snapshot — a login must be pollable without forcing
 * a quota re-read of every other provider.
 */
export const PROXY_MONITOR_ENDPOINTS = [
    /** Read the cached quota snapshot, refreshing upstream only when stale. */
    'snapshot',
    /** Force a re-read of every provider's quota. */
    'refresh',
    /** Read every proxied provider's account state (identity facts only). */
    'accounts',
    /** Start a login for one provider; payload `{ id }`. */
    'login',
    /** Poll one login attempt; payload `{ id, ticketId }`. */
    'loginPoll',
    /** End one provider's session; payload `{ id }`. */
    'logout',
];
//# sourceMappingURL=contract.js.map