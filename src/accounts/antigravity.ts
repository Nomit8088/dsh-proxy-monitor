/**
 * Antigravity unified account adapter over FileCredentialStore and beginWebLogin.
 *
 * Implements AccountAdapter:
 * - account(): reads current credentials from FileCredentialStore and returns status.
 * - beginLogin(): starts loopback OAuth flow via beginWebLogin, returns authorization URL.
 * - pollLogin(): polls getWebLoginStatus() until complete, error, or cancelled.
 * - logout(): deletes credentials file and resets cached quota.
 * - quota(): reads from the shared snapshot.
 */

import type { ProviderQuota, QuotaSnapshot } from '../contract.js'
import type {
  AccountAdapter,
  LoginTicket,
  ProviderAccount,
  ProxiedProviderId,
} from './contract.js'
import {
  FileCredentialStore,
  credentialPath,
  beginWebLogin,
  getWebLoginStatus,
} from '../antigravity/index.js'

const ID: ProxiedProviderId = 'antigravity'
const NAME = 'Antigravity'

export class AntigravityAccountAdapter implements AccountAdapter {
  readonly id: ProxiedProviderId = ID
  private currentTicketId: string | undefined
  private ticketSeq = 0

  constructor(
    private readonly store: InstanceType<typeof FileCredentialStore> = new FileCredentialStore(credentialPath()),
    private readonly readSnapshot: () => Promise<QuotaSnapshot>,
  ) {}

  async account(): Promise<ProviderAccount> {
    try {
      const credentials = await this.store.read()
      const signedIn = Boolean(credentials?.access || credentials?.refresh)
      const email = typeof credentials?.email === 'string' ? credentials.email : undefined
      const project = typeof credentials?.projectId === 'string' ? credentials.projectId : undefined

      const flow = getWebLoginStatus()
      const isPending = flow.status === 'pending'

      return {
        id: ID,
        name: NAME,
        state: signedIn ? 'signed-in' : flow.status === 'error' ? 'error' : 'signed-out',
        canLogout: signedIn,
        canReauth: true,
        account: email || project,
        login: {
          kind: 'browser',
          pending: isPending,
        },
        ...(flow.status === 'error' && !signedIn ? { error: flow.error } : {}),
      }
    } catch (error) {
      return {
        id: ID,
        name: NAME,
        state: 'error',
        canLogout: false,
        canReauth: true,
        login: { kind: 'none', reason: '无法读取 Antigravity 状态' },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async beginLogin(): Promise<LoginTicket> {
    this.ticketSeq += 1
    const id = `antigravity-${String(this.ticketSeq)}`
    this.currentTicketId = id

    try {
      const result = await beginWebLogin(this.store)
      return {
        id,
        method: {
          kind: 'browser',
          url: result.authUrl,
          pending: true,
        },
        done: false,
      }
    } catch (error) {
      return {
        id,
        method: {
          kind: 'none',
          reason: '发起 Antigravity 登录失败',
        },
        done: true,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async pollLogin(ticketId: string): Promise<LoginTicket> {
    if (this.currentTicketId !== ticketId) {
      return {
        id: ticketId,
        method: { kind: 'none', reason: '登录会话已失效' },
        done: true,
        error: '登录会话已失效',
      }
    }

    const flow = getWebLoginStatus()
    if (flow.status === 'complete') {
      this.currentTicketId = undefined
      return {
        id: ticketId,
        method: { kind: 'browser', pending: false },
        done: true,
      }
    }

    if (flow.status === 'error') {
      this.currentTicketId = undefined
      return {
        id: ticketId,
        method: { kind: 'none', reason: flow.error ?? '登录失败' },
        done: true,
        error: flow.error,
      }
    }

    return {
      id: ticketId,
      method: { kind: 'browser', pending: true },
      done: false,
    }
  }

  async logout(): Promise<void> {
    await this.store.delete()
  }

  async quota(): Promise<ProviderQuota> {
    try {
      const snapshot = await this.readSnapshot()
      const found = snapshot.providers.find(p => p.id === ID)
      return found ?? {
        id: ID,
        name: NAME,
        status: 'error',
        windows: [],
        error: 'Antigravity 不在额度快照中',
        fetchedAt: Date.now(),
      }
    } catch (error) {
      return {
        id: ID,
        name: NAME,
        status: 'error',
        windows: [],
        error: error instanceof Error ? error.message : String(error),
        fetchedAt: Date.now(),
      }
    }
  }
}
