/**
 * Browser-side caller for this plugin's Connection RPC channel.
 *
 * The browser half never reads a credential and never talks to a vendor: it
 * asks the Host for a snapshot, and the Host answers numbers. This module is
 * the only place that knows the channel's endpoint names.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/api
 */

import {
  PROXY_MONITOR_CHANNEL,
  type QuotaSnapshot,
  type RefreshResult,
} from '../contract.js'
import type { LoginTicket, ProviderAccount, ProxiedProviderId } from '../accounts/contract.js'

/** The slice of Connection's browser RPC face this plugin consumes. */
export interface ConnectionRpcCaller {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }>
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

/** Unwrap a Connection result, turning a failure into a thrown Error. */
function unwrap<T>(result: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value as T
}

/**
 * Build the snapshot broker over Connection's unary channel.
 * @param rpc - Connection's browser RPC face.
 * @returns the broker the UI uses.
 */
export function createQuotaBroker(rpc: ConnectionRpcCaller): QuotaBroker {
  return {
    async snapshot(signal) {
      return unwrap<QuotaSnapshot>(await rpc.call(PROXY_MONITOR_CHANNEL, 'snapshot', {}, signal))
    },
    async refresh(signal) {
      return unwrap<RefreshResult>(await rpc.call(PROXY_MONITOR_CHANNEL, 'refresh', {}, signal))
    },
    async accounts(signal) {
      return unwrap<ProviderAccount[]>(await rpc.call(PROXY_MONITOR_CHANNEL, 'accounts', {}, signal))
    },
    async login(id, signal) {
      return unwrap<LoginTicket>(await rpc.call(PROXY_MONITOR_CHANNEL, 'login', { id }, signal))
    },
    async pollLogin(id, ticketId, signal) {
      return unwrap<LoginTicket>(await rpc.call(PROXY_MONITOR_CHANNEL, 'loginPoll', { id, ticketId }, signal))
    },
    async logout(id, signal) {
      const value = unwrap<{ ok: boolean }>(await rpc.call(PROXY_MONITOR_CHANNEL, 'logout', { id }, signal))
      return value.ok
    },
  }
}
