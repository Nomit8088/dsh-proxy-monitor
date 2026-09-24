/**
 * The browser's account state: one subscription both surfaces share.
 *
 * The rail's account block and the settings page's tabs read the *same* account
 * list and the *same* in-flight login. Duplicating that state per surface would
 * let them disagree — the classic failure being a login started in the settings
 * page that the rail still renders as "signed out" until a refresh.
 *
 * So this is one small observable, modelled the same way as the existing
 * settings store: `getSnapshot`/`subscribe`, plus the actions that mutate it.
 * The slot framework's own contract is exactly that pair, which is why no state
 * library is involved.
 *
 * Polling discipline mirrors the quota rail's: a login is polled only while one
 * is genuinely in flight, and a hidden tab stops polling entirely.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/accounts/store
 */

import type { LoginTicket, ProviderAccount, ProxiedProviderId } from '../../accounts/contract.js'
import type { QuotaBroker } from '../api.js'

/** How often an in-flight login is polled, in milliseconds. */
const LOGIN_POLL_MS = 2000

/**
 * A device code and a browser callback both take a human a while; this bounds
 * the wait so a forgotten tab does not poll forever. Five minutes matches the
 * shortest expiry any provider's flow declares.
 */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

/** The live account state one surface subscribes to. */
export interface AccountState {
  /** One row per proxied provider; empty until the first read lands. */
  accounts: readonly ProviderAccount[]
  /** True while the first read is outstanding. */
  loading: boolean
  /** A transport-level failure, distinct from one provider's own error row. */
  error?: string | undefined
  /** The provider with a login in flight, when there is one. */
  busyId?: ProxiedProviderId | undefined
  /** The live instruction for that login, when there is one. */
  ticket?: { id: ProxiedProviderId; ticketId: string; method: LoginTicket['method'] } | undefined
}

/**
 * The account store: subscription, reads, and the login lifecycle.
 *
 * The login lifecycle is the only stateful part. It is deliberately a single
 * slot (`busyId`) rather than a per-provider map: two logins cannot usefully run
 * at once, and a single slot makes "which ticket am I polling" unambiguous —
 * the bug that a map invites is polling ticket A while displaying ticket B.
 */
export class AccountStore {
  private state: AccountState = { accounts: [], loading: true }
  private readonly listeners = new Set<() => void>()
  /** Timer for the in-flight login poll, when one is active. */
  private pollTimer: number | undefined
  /** Epoch ms after which an in-flight login is abandoned. */
  private deadline = 0
  /** Guards against a late poll publishing after a newer login started. */
  private generation = 0

  /**
   * @param broker - the RPC broker this store reads and acts through.
   */
  constructor(private readonly broker: QuotaBroker) {}

  /** The current state; identity is stable until a change is published. */
  getSnapshot(): AccountState {
    return this.state
  }

  /** Observe publishes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Publish a partial change. */
  private publish(patch: Partial<AccountState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /**
   * Read every account once.
   *
   * A failure sets the transport-level `error` but keeps the previous rows: a
   * transient RPC failure must not blank a page that was showing useful state.
   *
   * @param signal - optional cancellation.
   */
  async refresh(signal?: AbortSignal): Promise<void> {
    try {
      const accounts = await this.broker.accounts(signal)
      this.publish({ accounts, loading: false, error: undefined })
    } catch (error) {
      this.publish({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Start a login and begin polling it.
   *
   * Polling stops on completion, on failure, and at the deadline; each publish
   * carries the ticket so the UI can render the code or link the provider
   * returned.
   *
   * @param id - provider to sign in to.
   */
  async login(id: ProxiedProviderId): Promise<void> {
    this.stopPolling()
    const generation = ++this.generation
    this.publish({ busyId: id, error: undefined })
    try {
      const ticket = await this.broker.login(id)
      if (generation !== this.generation) return
      this.publish({ ticket: { id, ticketId: ticket.id, method: ticket.method } })
      if (ticket.done) {
        await this.finishLogin(id, ticket)
        return
      }
      this.deadline = Date.now() + LOGIN_TIMEOUT_MS
      this.schedulePoll(id, ticket.id, generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.clearLogin(error instanceof Error ? error.message : String(error))
    }
  }

  /** Poll one ticket once, repeatedly, until it settles or the deadline passes. */
  private schedulePoll(id: ProxiedProviderId, ticketId: string, generation: number): void {
    this.pollTimer = window.setTimeout(() => {
      void this.poll(id, ticketId, generation)
    }, LOGIN_POLL_MS)
  }

  /** One poll step. */
  private async poll(id: ProxiedProviderId, ticketId: string, generation: number): Promise<void> {
    // A hidden tab must not keep polling an endpoint the user is not watching.
    if (document.visibilityState !== 'visible') {
      this.schedulePoll(id, ticketId, generation)
      return
    }
    if (Date.now() > this.deadline) {
      this.clearLogin('登录等待超时，请重试。')
      return
    }
    try {
      const ticket = await this.broker.pollLogin(id, ticketId)
      if (generation !== this.generation) return
      this.publish({ ticket: { id, ticketId: ticket.id, method: ticket.method } })
      if (ticket.done) {
        await this.finishLogin(id, ticket)
        return
      }
      if (ticket.error !== undefined) {
        this.clearLogin(ticket.error)
        return
      }
      this.schedulePoll(id, ticketId, generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.clearLogin(error instanceof Error ? error.message : String(error))
    }
  }

  /** Adopt a settled ticket's outcome and re-read the account list. */
  private async finishLogin(id: ProxiedProviderId, ticket: LoginTicket): Promise<void> {
    this.stopPolling()
    // Re-read rather than trust the ticket: the provider's own state is the
    // authority on whether the credential is now usable.
    await this.refresh()
    const stillOut = this.state.accounts.find(account => account.id === id)?.state !== 'signed-in'
    this.publish({
      busyId: undefined,
      ticket: undefined,
      ...(ticket.error === undefined && !stillOut ? {} : { error: ticket.error ?? '登录未完成' }),
    })
  }

  /** Abandon an in-flight login with a message. */
  private clearLogin(message: string): void {
    this.stopPolling()
    this.publish({ busyId: undefined, ticket: undefined, error: message })
  }

  /** Cancel any pending poll. */
  private stopPolling(): void {
    if (this.pollTimer !== undefined) {
      window.clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  /**
   * End one provider's session and re-read.
   * @param id - provider to sign out of.
   */
  async logout(id: ProxiedProviderId): Promise<void> {
    this.stopPolling()
    this.generation += 1
    try {
      await this.broker.logout(id)
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : String(error) })
    }
    this.publish({ busyId: undefined, ticket: undefined })
    await this.refresh()
  }

  /** Release the poll timer; call when the owning plugin unloads. */
  dispose(): void {
    this.generation += 1
    this.stopPolling()
    this.listeners.clear()
  }
}
