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
export const PROXY_MONITOR_CHANNEL = '/proxy-monitor';
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
//# sourceMappingURL=contract.js.map