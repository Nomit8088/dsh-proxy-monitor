/**
 * Loopback bridge for the Codex OAuth callback.
 *
 * pi-ai owns the Codex OAuth flow. It hard-codes the redirect URI the provider
 * has registered for the Codex client — `http://localhost:1455/auth/callback` —
 * and binds one loopback family only: `listen(1455, PI_OAUTH_CALLBACK_HOST ??
 * '127.0.0.1')`. `localhost` is not a synonym for `127.0.0.1`: on a host whose
 * resolver answers `::1` first for `localhost` (Windows without a `localhost`
 * hosts entry, where `::1/128` carries the highest prefix precedence), the
 * browser's redirect to the callback is refused and the sign-in ends on pi-ai's
 * "OpenAI Codex sign-in timed out waiting for the browser callback" — the
 * symptom this module removes.
 *
 * The address nobody serves is therefore bridged: a loopback TCP forwarder on
 * the *other* family relays to the one pi-ai bound, for as long as one sign-in
 * operation is in flight, and is released with it. Nothing is exposed beyond
 * loopback. When the address is unavailable (IPv6 disabled) or already answered
 * by the provider listener itself, the bind fails and the flow proceeds exactly
 * as before.
 *
 * @module @dsh-external/dsh-proxy-monitor/codex/loopback-bridge
 */
import { connect, createServer } from 'node:net';
/**
 * Callback port of the Codex OAuth client.
 *
 * Mirrors the value pi-ai's `openai-codex` flow redirects to; the provider holds
 * `http://localhost:<port>/auth/callback` as the client's registered redirect,
 * so it is not configurable from here — only the *binding* can be widened.
 */
export const OPENAI_CODEX_CALLBACK_PORT = 1455;
/** The IPv6 loopback literal. */
const IPV6_LOOPBACK = '::1';
/** The IPv4 loopback literal. */
const IPV4_LOOPBACK = '127.0.0.1';
/**
 * Read the address the provider's own listener binds.
 *
 * Mirrors pi-ai's `getCallbackHost()`: its environment override, or IPv4.
 * @param env - environment to read; defaults to the process environment.
 * @returns the bound address.
 */
export function codexCallbackHost(env = process.env) {
    const configured = env['PI_OAUTH_CALLBACK_HOST']?.trim();
    return configured === undefined || configured === '' ? IPV4_LOOPBACK : configured;
}
/**
 * Relay one loopback address to another on the same port.
 *
 * @param listenHost - address a browser may resolve to but nobody serves.
 * @param port - callback port, shared with the provider-owned listener.
 * @param targetHost - address the provider-owned listener bound.
 * @returns a disposer, or undefined when the local bind is refused outright.
 */
export function startLoopbackBridge(listenHost, port, targetHost) {
    const server = createServer(client => {
        const upstream = connect({ host: targetHost, port });
        const abort = () => {
            client.destroy();
            upstream.destroy();
        };
        client.on('error', abort);
        upstream.on('error', abort);
        client.pipe(upstream).pipe(client);
    });
    // A refused bind (address family unavailable, or the provider listener already
    // owns it) arrives asynchronously; it means "no bridge needed", never a failed
    // sign-in, so it is deliberately swallowed.
    server.on('error', () => undefined);
    try {
        server.listen(port, listenHost);
    }
    catch {
        return undefined;
    }
    return () => {
        try {
            server.close();
        }
        catch {
            // Already closed.
        }
    };
}
/**
 * Bridge the loopback family pi-ai did not bind for the callback port.
 *
 * @param env - environment to read the provider's override from.
 * @returns a disposer, or undefined when no bridge is possible.
 */
export function startCodexCallbackBridge(env = process.env) {
    const target = codexCallbackHost(env);
    const missing = target === IPV6_LOOPBACK ? IPV4_LOOPBACK : IPV6_LOOPBACK;
    return startLoopbackBridge(missing, OPENAI_CODEX_CALLBACK_PORT, target);
}
//# sourceMappingURL=loopback-bridge.js.map