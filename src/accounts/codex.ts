/**
 * Codex unified account adapter over OpenAICodexCredentialStore and OpenAICodexWebAuth.
 *
 * Implements AccountAdapter:
 * - account(): reads current auth status and reports signed-in/signed-out, canLogout, canReauth.
 * - beginLogin(): starts browser OAuth flow, yields verification URL.
 * - pollLogin(): polls status until completed or cancelled.
 * - logout(): deletes stored OAuth credential.
 * - quota(): reads from the shared snapshot.
 */

import type { ProviderQuota, QuotaSnapshot } from '../contract.js'
import type {
  AccountAdapter,
  LoginTicket,
  ProviderAccount,
  ProxiedProviderId,
} from './contract.js'
import { OpenAICodexCredentialStore, OPENAI_CODEX_PROVIDER } from '../codex/store.js'
import { OpenAICodexWebAuth } from '../codex/auth-routes.js'
import { logoutOpenAICodex } from '../codex/auth.js'

const ID: ProxiedProviderId = 'codex'
const NAME = 'Codex'

export class CodexAccountAdapter implements AccountAdapter {
  readonly id: ProxiedProviderId = ID
  private currentTicketId: string | undefined
  private ticketSeq = 0

  constructor(
    private readonly store: OpenAICodexCredentialStore,
    private readonly webAuth: OpenAICodexWebAuth,
    private readonly readSnapshot: () => Promise<QuotaSnapshot>,
  ) {}

  async account(): Promise<ProviderAccount> {
    try {
      const status = await this.webAuth.status()
      const signedIn = status.status === 'signed-in'
      const signingIn = status.status === 'signing-in'

      return {
        id: ID,
        name: NAME,
        state: signedIn ? 'signed-in' : status.status === 'error' ? 'error' : 'signed-out',
        canLogout: signedIn,
        canReauth: true,
        login: {
          kind: 'browser',
          pending: signingIn,
        },
        ...(status.status === 'error' ? { error: status.message } : {}),
      }
    } catch (error) {
      return {
        id: ID,
        name: NAME,
        state: 'error',
        canLogout: false,
        canReauth: true,
        login: { kind: 'none', reason: '无法读取 Codex 状态' },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async beginLogin(): Promise<LoginTicket> {
    this.ticketSeq += 1
    const id = `codex-${String(this.ticketSeq)}`
    this.currentTicketId = id

    try {
      const challenge = await this.webAuth.signIn()
      return {
        id,
        method: {
          kind: 'browser',
          url: challenge.url,
          pending: true,
        },
        done: false,
      }
    } catch (error) {
      return {
        id,
        method: {
          kind: 'none',
          reason: '发起 Codex 登录失败',
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

    const status = await this.webAuth.status()
    if (status.status === 'signed-in') {
      this.currentTicketId = undefined
      return {
        id: ticketId,
        method: { kind: 'browser', pending: false },
        done: true,
      }
    }

    if (status.status === 'error') {
      this.currentTicketId = undefined
      return {
        id: ticketId,
        method: { kind: 'none', reason: status.message },
        done: true,
        error: status.message,
      }
    }

    return {
      id: ticketId,
      method: { kind: 'browser', pending: true },
      done: false,
    }
  }

  async logout(): Promise<void> {
    await this.webAuth.signOut()
    await logoutOpenAICodex(this.store)
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
        error: 'Codex 不在额度快照中',
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
