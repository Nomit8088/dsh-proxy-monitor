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
/** Durable settings namespace registered by the Host and read by the browser. */
export const PROXY_MONITOR_NAMESPACE = 'dsh-proxy-monitor';
//# sourceMappingURL=contract.js.map