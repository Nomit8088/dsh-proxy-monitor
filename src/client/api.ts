/**
 * Browser-side caller for this plugin's own Host routes.
 *
 * The browser half never reads a credential and never talks to a vendor: it
 * asks the Host for a snapshot, and the Host answers numbers. This module is
 * the only place that knows the route and the endpoint names.
 *
 * The route is an exact POST route on Connection's shared, authenticated
 * `/api` channel, so one ordinary same-origin `fetch` reaches it — no RPC
 * client, no channel registration, and the platform's Host/Origin fence and
 * browser authentication are already applied on the Host side.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/api
 */

import {
  PROXY_MONITOR_ROUTE,
  type ProxyMonitorEndpoint,
  type QuotaSnapshot,
  type RefreshResult,
} from '../contract.js'
import type { LoginTicket, ProviderAccount, ProxiedProviderId } from '../accounts/contract.js'

/** One reply as this plugin's routes produce it. */
export type ProxyMonitorReply =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } }

/** The same-origin POST face this plugin's routes are reached through. */
export interface ProxyMonitorTransport {
  post(endpoint: ProxyMonitorEndpoint, payload: unknown, signal?: AbortSignal): Promise<ProxyMonitorReply>
}

/** The broker the rail renders from. */
export interface QuotaBroker {
  /** Read the cached snapshot, refreshing upstream only when it has aged out. */
  snapshot(signal?: AbortSignal): Promise<QuotaSnapshot>
  /** Force a re-read of every provider. */
  refresh(signal?: AbortSignal): Promise<RefreshResult>
  /** Read every proxied provider's account state (identity facts only). */
  accounts(signal?: AbortSignal): Promise<ProviderAccount[]>
  /** Start a login and get the instruction to display. */
  login(id: ProxiedProviderId, signal?: AbortSignal): Promise<LoginTicket>
  /** Poll one in-flight login. */
  pollLogin(id: ProxiedProviderId, ticketId: string, signal?: AbortSignal): Promise<LoginTicket>
  /** End one provider's session; false when that provider has no logout. */
  logout(id: ProxiedProviderId, signal?: AbortSignal): Promise<boolean>
}

/** Unwrap a reply, turning a refusal into a thrown Error. */
function unwrap<T>(result: ProxyMonitorReply): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value as T
}

/**
 * Build the transport over the page's own `fetch`.
 *
 * The route is document-relative (leading slash stripped) for the same reason
 * the platform's own caller does it: the shell may be mounted under a path
 * prefix, and a relative URL keeps that prefix.
 *
 * @param doFetch - transport override, for tests.
 * @returns the transport the broker and the account store share.
 */
export function createProxyMonitorTransport(doFetch?: typeof fetch): ProxyMonitorTransport {
  const send = doFetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  return {
    async post(endpoint, payload, signal) {
      const response = await send(`${PROXY_MONITOR_ROUTE}/${endpoint}`.slice(1), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) {
        throw new Error(`transport failure for ${PROXY_MONITOR_ROUTE}/${endpoint}: HTTP ${response.status}`)
      }
      return await response.json() as ProxyMonitorReply
    },
  }
}

/**
 * Build the snapshot broker over the plugin's transport.
 * @param transport - this plugin's same-origin routes.
 * @returns the broker the UI uses.
 */
export function createQuotaBroker(transport: ProxyMonitorTransport): QuotaBroker {
  return {
    async snapshot(signal) {
      return unwrap<QuotaSnapshot>(await transport.post('snapshot', {}, signal))
    },
    async refresh(signal) {
      return unwrap<RefreshResult>(await transport.post('refresh', {}, signal))
    },
    async accounts(signal) {
      return unwrap<ProviderAccount[]>(await transport.post('accounts', {}, signal))
    },
    async login(id, signal) {
      return unwrap<LoginTicket>(await transport.post('login', { id }, signal))
    },
    async pollLogin(id, ticketId, signal) {
      return unwrap<LoginTicket>(await transport.post('loginPoll', { id, ticketId }, signal))
    },
    async logout(id, signal) {
      const value = unwrap<{ ok: boolean }>(await transport.post('logout', { id }, signal))
      return value.ok
    },
  }
}
