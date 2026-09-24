/**
 * Environment HTTP proxy installation for the running host process.
 *
 * Node's built-in fetch (undici) does not honour `HTTP_PROXY`/`HTTPS_PROXY`
 * environment variables, while this machine's other tools (curl, python,
 * the grok CLI) all route through the local proxy — so on such a network
 * every OAuth or LLM request from this plugin would fail with a connect
 * timeout. Installing an `EnvHttpProxyAgent` as the global dispatcher makes
 * the host behave like the rest of the system: proxy variables are honoured
 * (with `NO_PROXY` bypassing for localhost and friends), and on a machine
 * with no proxy variables set this is a no-op.
 *
 * @module dsh-grok-auth/env-proxy
 */
/**
 * Install the env-proxy dispatcher once, when the process environment names
 * a proxy. Safe to call at any plugin load; repeated calls are no-ops.
 * @param log - diagnostic sink (never receives proxy credentials).
 */
export declare function installEnvHttpProxy(log: (message: unknown) => void): void;
