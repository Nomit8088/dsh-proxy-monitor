/** Browser-safe dedicated Connection RPC contract owned by grok-auth. */

import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'

/** Logical channel registered by the plugin's Host half and called by its browser half. */
export const GROK_AUTH_RPC_CHANNEL = '/grok-auth'

/**
 * One login flow: `browser` spawns the official `grok login` CLI flow;
 * `device` runs the RFC 8628 device-code flow inside the Host and surfaces
 * the user code through this channel.
 */
export type GrokAuthLoginMode = 'browser' | 'device'

/** A pending device-code login awaiting approval; token values are intentionally absent. */
export interface GrokPendingLoginView {
  userCode: string
  verificationUri: string
  /** ISO timestamp after which the device code is dead. */
  expiresAt: string
}

/** Value-free login state; token values are intentionally absent. */
export interface GrokAuthStatusView {
  available: boolean
  configured: boolean
  authMode?: string
  grokVersion?: string
  tokenExpiresAt?: string
  /** ISO timestamp the current token set was issued/refreshed, when recorded. */
  createdAt?: string
  /** Account email recorded by the official CLI; an identity fact, never a credential. */
  email?: string
  credentialRef: string
  authFileExists: boolean
  /** Present while a Host-run device-code login awaits approval. */
  pendingLogin?: GrokPendingLoginView
  /** Last device-login failure, when one is worth showing; cleared by the next attempt. */
  lastLoginError?: string
}

/** Value-free weekly usage snapshot for the settings login block. */
export interface GrokUsageView {
  /** Remaining percentage (0-100) of the weekly subscription credit window; absent when unknown. */
  weeklyRemainingPercent?: number
  /** ISO timestamp of the weekly window's next reset; absent when unknown. */
  weeklyResetAt?: string
}

/** Reply to one login request; device mode carries the code to show the user. */
export interface GrokLoginStartView {
  started: boolean
  userCode?: string
  verificationUri?: string
  expiresInSeconds?: number
}

/** Browser-safe face consumed by the settings card. */
export interface GrokAuthRpcClient {
  /** Read the value-free Grok login state. */
  status(signal?: AbortSignal): Promise<ConnectionRpcResult<{ status: GrokAuthStatusView }>>
  /** Read the value-free weekly usage snapshot from the Grok backend. */
  usage(signal?: AbortSignal): Promise<ConnectionRpcResult<{ usage: GrokUsageView }>>
  /** Start one login flow. */
  login(mode: GrokAuthLoginMode, signal?: AbortSignal): Promise<ConnectionRpcResult<{ login: GrokLoginStartView }>>
}

/** Minimal generic Connection caller required by this plugin. */
export interface GrokAuthConnectionRpc {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<ConnectionRpcResult<unknown>>
}

/** Build the browser face over Connection's plugin-owned unary channel. */
export function createGrokAuthRpcClient(rpc: GrokAuthConnectionRpc): GrokAuthRpcClient {
  return {
    status: async (signal) => {
      const result = await rpc.call(GROK_AUTH_RPC_CHANNEL, 'status', {}, signal)
      if (!result.ok) return result
      const status = parseStatusResult(result.value)
      return status === undefined ? invalidResponse('status') : { ok: true, value: { status } }
    },
    usage: async (signal) => {
      const result = await rpc.call(GROK_AUTH_RPC_CHANNEL, 'usage', {}, signal)
      if (!result.ok) return result
      const usage = parseUsageResult(result.value)
      return usage === undefined ? invalidResponse('usage') : { ok: true, value: { usage } }
    },
    login: async (mode, signal) => {
      const result = await rpc.call(GROK_AUTH_RPC_CHANNEL, 'login', { mode }, signal)
      if (!result.ok) return result
      const login = parseLoginResult(result.value)
      return login === undefined ? invalidResponse('login') : { ok: true, value: { login } }
    },
  }
}

function parseStatusResult(value: unknown): GrokAuthStatusView | undefined {
  if (!isRecord(value) || !isRecord(value.status)) return undefined
  const status = value.status
  if (
    typeof status.available !== 'boolean'
    || typeof status.configured !== 'boolean'
    || typeof status.credentialRef !== 'string'
    || typeof status.authFileExists !== 'boolean'
  ) return undefined
  for (const key of ['authMode', 'grokVersion', 'tokenExpiresAt', 'createdAt', 'email', 'lastLoginError'] as const) {
    if (status[key] !== undefined && typeof status[key] !== 'string') return undefined
  }
  let pendingLogin: GrokPendingLoginView | undefined
  if (status.pendingLogin !== undefined) {
    if (!isRecord(status.pendingLogin)
      || typeof status.pendingLogin.userCode !== 'string'
      || typeof status.pendingLogin.verificationUri !== 'string'
      || typeof status.pendingLogin.expiresAt !== 'string') return undefined
    pendingLogin = {
      userCode: status.pendingLogin.userCode,
      verificationUri: status.pendingLogin.verificationUri,
      expiresAt: status.pendingLogin.expiresAt,
    }
  }
  return {
    available: status.available,
    configured: status.configured,
    ...typeof status.authMode === 'string' ? { authMode: status.authMode } : {},
    ...typeof status.grokVersion === 'string' ? { grokVersion: status.grokVersion } : {},
    ...typeof status.tokenExpiresAt === 'string' ? { tokenExpiresAt: status.tokenExpiresAt } : {},
    ...typeof status.createdAt === 'string' ? { createdAt: status.createdAt } : {},
    ...typeof status.email === 'string' ? { email: status.email } : {},
    credentialRef: status.credentialRef,
    authFileExists: status.authFileExists,
    ...pendingLogin === undefined ? {} : { pendingLogin },
    ...typeof status.lastLoginError === 'string' ? { lastLoginError: status.lastLoginError } : {},
  }
}

function parseUsageResult(value: unknown): GrokUsageView | undefined {
  if (!isRecord(value) || !isRecord(value.usage)) return undefined
  const usage = value.usage
  if (usage.weeklyResetAt !== undefined && typeof usage.weeklyResetAt !== 'string') return undefined
  if (
    usage.weeklyRemainingPercent !== undefined
    && (!Number.isSafeInteger(usage.weeklyRemainingPercent)
      || (usage.weeklyRemainingPercent as number) < 0
      || (usage.weeklyRemainingPercent as number) > 100)
  ) return undefined
  return {
    ...typeof usage.weeklyRemainingPercent === 'number' ? { weeklyRemainingPercent: usage.weeklyRemainingPercent } : {},
    ...typeof usage.weeklyResetAt === 'string' ? { weeklyResetAt: usage.weeklyResetAt } : {},
  }
}

function parseLoginResult(value: unknown): GrokLoginStartView | undefined {
  if (!isRecord(value) || !isRecord(value.login)) return undefined
  const login = value.login
  if (typeof login.started !== 'boolean') return undefined
  if (login.userCode !== undefined && typeof login.userCode !== 'string') return undefined
  if (login.verificationUri !== undefined && typeof login.verificationUri !== 'string') return undefined
  if (login.expiresInSeconds !== undefined && typeof login.expiresInSeconds !== 'number') return undefined
  return {
    started: login.started,
    ...typeof login.userCode === 'string' ? { userCode: login.userCode } : {},
    ...typeof login.verificationUri === 'string' ? { verificationUri: login.verificationUri } : {},
    ...typeof login.expiresInSeconds === 'number' ? { expiresInSeconds: login.expiresInSeconds } : {},
  }
}

function invalidResponse(endpoint: string): ConnectionRpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: `grok-auth: invalid ${endpoint} response from Host`,
      details: {},
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
