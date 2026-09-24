/**
 * Grok's account adapter: the first real implementation of the unified face.
 *
 * Grok is the reference implementation because it is the only provider whose
 * login can be driven entirely inside the Host: the RFC 8628 device flow asks
 * auth.x.ai for a code, shows it to the user, and polls until the user approves.
 * Codex and Antigravity need a browser round trip through a loopback callback,
 * and WorkBuddy has no login this plugin owns — so getting this one right
 * exercises every branch of {@link LoginMethod} the UI has to render except
 * `browser`.
 *
 * ## Where the facts come from
 *
 * Everything is read through the ported {@link GrokAuthService}, never by
 * touching the auth file directly. That matters because the service is the only
 * component that owns the cross-process writer lock: a second reader of
 * `~/.grok/auth.json` would race the official CLI's own refresh and could serve
 * a token the CLI had already rotated away.
 *
 * ## Why polling reads `status()` rather than a login-specific endpoint
 *
 * The service starts a background flight when a device login begins and adopts
 * the tokens itself once approved. There is no "poll the login" method to call,
 * and inventing one would mean a second source of truth for "is this login
 * done". So {@link GrokAccountAdapter.pollLogin} reads the same `status()` the
 * rail reads: the presence of a credential *is* the completion signal, which
 * also makes the login and the account display incapable of disagreeing.
 *
 * @module @dsh-external/dsh-proxy-monitor/accounts/grok
 */

import type { ProviderQuota, QuotaSnapshot, QuotaWindow } from '../contract.js'
import type { AccountAdapter, LoginTicket, ProviderAccount, ProxiedProviderId } from './contract.js'
import type { GrokAuthService } from '../grok/grok-auth-service.js'
import { clampPercent, usedFromRemaining, windowOf } from '../providers/util.js'

/** The provider id this adapter serves. */
const ID: ProxiedProviderId = 'grok'
/** Display name, matching the rail's row. */
const NAME = 'Grok'

/**
 * One device login as this adapter tracks it.
 *
 * A ticket is held rather than re-derived from the service because the service
 * keeps only the *current* pending login; keeping our own record lets a poll for
 * a superseded ticket answer honestly instead of adopting a newer attempt's
 * state.
 */
interface PendingTicket {
  id: string
  /** ISO expiry, so a poll after the deadline can report it rather than hang. */
  expiresAt: string
  /**
   * Whether a credential already existed when this ticket was minted.
   *
   * This is what distinguishes a fresh login from a re-authentication, and the
   * two need different completion signals. For a fresh login, `configured`
   * flipping to true *is* the event. For a re-auth it is already true at the
   * start, so treating it as the signal would report instant success before the
   * user had done anything.
   */
  startedConfigured: boolean
  /** Identity at ticket time, so a re-auth that swaps accounts is detectable. */
  startedAccount: string | undefined
  /**
   * Whether the provider's pending login has been observed at least once.
   *
   * The device flow is started asynchronously by the service, so the first poll
   * can land before it has registered. Completion for a re-auth requires having
   * seen the pending state and then seen it clear — otherwise "not yet started"
   * and "already finished" are indistinguishable.
   */
  sawPending: boolean
}

/** A short, value-free reason for a failed account read. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Map a weekly usage view onto the rail's quota contract.
 *
 * The upstream reports *remaining* percent while the rail meters *consumed*, so
 * the inversion happens here at the adapter edge — the same rule every other
 * provider adapter follows.
 *
 * The service reports a *failure* to resolve a credential as an empty usage view
 * rather than an exception, because its own settings card renders dashes for
 * "unknown". That distinction is wrong for this surface: the rail and the quota
 * panel must say *why* nothing came back, or a login that silently did not take
 * effect looks identical to a provider that simply has no allowance to report.
 * So the empty view is turned into an explicit error row here.
 *
 * @param usage - the value-free usage view the service returned.
 * @param signedIn - whether the credential resolved, to word the failure.
 * @returns a quota row.
 */
function quotaFromUsage(
  usage: { weeklyRemainingPercent?: number; weeklyResetAt?: string },
  signedIn: boolean,
): ProviderQuota {
  const base = { id: ID, name: NAME, fetchedAt: Date.now() } as const
  if (usage.weeklyRemainingPercent === undefined) {
    return {
      ...base,
      status: signedIn ? 'error' : 'unconfigured',
      windows: [],
      error: signedIn
        ? 'Grok 未返回周额度：上游计费接口未返回可用数值（令牌可能已失效，或接口暂时不可用）。'
        : 'Grok 凭证不可用：无法读取 ~/.grok/auth.json 或令牌刷新失败。请在下方重新登录。',
    }
  }
  const window: QuotaWindow = windowOf(
    { id: 'weekly-credits', label: 'Weekly credits', kind: 'weekly' },
    {
      usedPercent: usedFromRemaining(clampPercent(usage.weeklyRemainingPercent)),
      resetAt: usage.weeklyResetAt,
      detail: 'subscription credit window',
    },
  )
  return {
    ...base,
    status: 'ok',
    plan: 'SuperGrok subscription',
    usedPercent: window.usedPercent,
    windows: [window],
  }
}

/**
 * Build the collector's `grok` reader over the ported auth service.
 *
 * This is the *source* of Grok's snapshot row, so it calls the service directly
 * — routing it through the snapshot would be circular. Its whole purpose is
 * single ownership of the credential: the service refreshes the token under the
 * cross-process lock, so the rail's ring is computed from a token that was
 * refreshed if it needed to be. The standalone reader in `providers/grok.ts`
 * reads the same file but owns no refresh, and would paint the rail red for a
 * token the service would have renewed.
 *
 * @param service - the ported Grok auth service.
 * @returns a reader shaped for the collector's override slot.
 */
export function createGrokQuotaReader(
  service: GrokAuthService,
): () => Promise<ProviderQuota> {
  return async () => {
    try {
      // Ask whether a credential resolves at all, so an unreadable credential
      // is reported as "not signed in" rather than as a generic upstream error.
      // `status()` is one stat in the common case, and it is the same call the
      // account row makes, so this adds no meaningful cost.
      const status = await service.status()
      return quotaFromUsage(await service.usage(), status.configured)
    } catch (error) {
      return { id: ID, name: NAME, status: 'error', windows: [], error: reasonOf(error), fetchedAt: Date.now() }
    }
  }
}

/**
 * Grok's unified account adapter over the ported auth service.
 *
 * Holds at most one pending login at a time, mirroring the service: the device
 * flow is a singleton upstream, so allowing two here would let the UI show a
 * code that the service had already replaced.
 */
export class GrokAccountAdapter implements AccountAdapter {
  readonly id = ID
  /** The one login this adapter is currently tracking, if any. */
  private pending: PendingTicket | undefined
  /** Monotonic counter for ticket ids; never reused, so a stale poll cannot match. */
  private ticketSeq = 0

  /**
   * @param service - the ported Grok auth service (owns the credential and lock).
   * @param readSnapshot - reads the collector's current snapshot. Used for
   *   {@link quota} so the rail and the settings panel share one upstream read
   *   instead of each paying for its own; the collector already reads Grok
   *   through this same service, so the bytes are the service's either way.
   */
  constructor(
    private readonly service: GrokAuthService,
    private readonly readSnapshot: () => Promise<QuotaSnapshot>,
  ) {}

  /**
   * Read Grok's login state.
   *
   * `status()` is the authority: `configured` means a usable credential exists,
   * which is exactly `signed-in`. A pending device login is surfaced through the
   * `login` method so the UI can keep showing the code while the user approves.
   *
   * @returns the account row; never throws.
   */
  async account(): Promise<ProviderAccount> {
    try {
      const status = await this.service.status()
      // Re-authentication is always offered: the device flow can replace a
      // credential as well as create one, and a valid-but-wrong account has no
      // other recovery path from inside the UI.
      const canReauth = true
      if (status.configured) {
        return {
          id: ID,
          name: NAME,
          state: 'signed-in',
          // Logout is not implemented for any provider yet (see adapters.ts):
          // removing a Grok session means deleting an entry from a document the
          // official CLI also owns, which is a separate change.
          canLogout: false,
          canReauth,
          ...(status.email === undefined ? {} : { account: status.email }),
          // Derived from the same helper as the signed-out branch, so the two
          // cannot drift. The block does not render this instruction while
          // signed in, but a stale method here would surface the moment the
          // credential lapsed.
          login: this.loginMethodFor(status),
        }
      }
      // A failure the service recorded belongs on the row; a plain "not signed
      // in" does not, because it is the normal state, not an error.
      const error = status.lastLoginError
      return {
        id: ID,
        name: NAME,
        state: error === undefined ? 'signed-out' : 'error',
        canLogout: false,
        canReauth,
        login: this.loginMethodFor(status),
        ...(error === undefined ? {} : { error }),
      }
    } catch (error) {
      return {
        id: ID,
        name: NAME,
        state: 'error',
        canLogout: false,
        canReauth: true,
        login: { kind: 'device-request' },
        error: reasonOf(error),
      }
    }
  }

  /**
   * What the user should do for the current state.
   *
   * A live pending device login wins: the user is mid-flow and needs the code,
   * not a suggestion to start over. Otherwise the idle state is `device-request`
   * — a code the button will fetch — with the official CLI command attached as
   * an *alternative* when that CLI is installed.
   *
   * The distinction is not cosmetic. The button runs {@link beginLogin}, which
   * always drives the Host-run device flow; advertising `grok login` as the
   * instruction made the label describe a command the button does not run, and a
   * user who followed it would have logged in through a path this plugin cannot
   * observe. The CLI is therefore reported as a secondary hint, never as the
   * primary instruction.
   *
   * @param status - the current service status.
   * @returns the method to render.
   */
  private loginMethodFor(status: {
    available: boolean
    pendingLogin?: { userCode: string; verificationUri: string; expiresAt: string }
  }): ProviderAccount['login'] {
    const pending = status.pendingLogin
    if (pending !== undefined) {
      return {
        kind: 'device',
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
        expiresAt: pending.expiresAt,
      }
    }
    return status.available
      ? { kind: 'device-request', cliCommand: 'grok login' }
      : { kind: 'device-request' }
  }

  /**
   * Start a device-code login.
   *
   * The device flow is chosen over the CLI flow deliberately: it is the one that
   * works without the official CLI installed, and it is the only one whose
   * progress this plugin can observe. The CLI flow hands the whole dance to an
   * external process whose completion the Host cannot see, so it cannot drive a
   * polling ticket.
   *
   * @returns the ticket describing the code to show.
   */
  async beginLogin(): Promise<LoginTicket> {
    // Snapshot the pre-login state before starting: it is what lets the poll
    // below tell "this login completed" from "a credential was already here".
    const before = await this.service.status()
    const started = await this.service.login('device')
    this.ticketSeq += 1
    const id = `grok-${String(this.ticketSeq)}`
    const expiresAt = new Date(Date.now() + (started.expiresInSeconds ?? 300) * 1000).toISOString()
    this.pending = {
      id,
      expiresAt,
      startedConfigured: before.configured,
      startedAccount: before.email,
      sawPending: false,
    }

    if (started.userCode === undefined || started.verificationUri === undefined) {
      // A device reply without a code is not something the user can act on.
      return { id, method: { kind: 'none', reason: '设备码登录未返回可用指令' }, done: true, error: '设备码登录启动失败' }
    }
    return {
      id,
      method: {
        kind: 'device',
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        expiresAt,
      },
      done: false,
    }
  }

  /**
   * Continue one device login.
   *
   * Completion is read from the provider's own state, never tracked locally, so
   * a ticket can never claim a success the credential does not support.
   *
   * The signal differs by ticket, which is the subtlety this method exists to
   * handle:
   *
   * - **Fresh login**: the credential appearing is the event.
   * - **Re-authentication**: a credential was already present, so its mere
   *   presence proves nothing. Completion is *the pending code appearing and
   *   then clearing*, optionally with the identity changing. Without that
   *   distinction a re-auth would report instant success before the user had
   *   done anything — the failure mode that makes a login button look broken
   *   precisely when the user is trying to switch accounts.
   *
   * @param ticketId - the id returned by {@link beginLogin}.
   * @returns the updated ticket.
   */
  async pollLogin(ticketId: string): Promise<LoginTicket> {
    const pending = this.pending
    if (pending === undefined || pending.id !== ticketId) {
      // A superseded or unknown ticket must not adopt the current attempt's
      // outcome; answering `done` stops the caller's loop cleanly.
      return this.settled(ticketId, '登录会话已失效')
    }

    const status = await this.service.status()
    if (status.lastLoginError !== undefined) {
      this.pending = undefined
      return this.settled(ticketId, status.lastLoginError)
    }
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      this.pending = undefined
      return this.settled(ticketId, '设备码已过期，请重新发起登录')
    }

    const live = status.pendingLogin
    if (live !== undefined) {
      // Track that the code really went live; completion depends on it.
      pending.sawPending = true
      return {
        id: ticketId,
        method: {
          kind: 'device',
          userCode: live.userCode,
          verificationUri: live.verificationUri,
          expiresAt: live.expiresAt,
        },
        done: false,
      }
    }

    // No live code. Completion now depends on which kind of login this was.
    if (!pending.startedConfigured) {
      if (status.configured) {
        this.pending = undefined
        return { id: ticketId, method: { kind: 'device-request' }, done: true }
      }
      // A fresh login with no code, no credential, and no error: the service has
      // not published the code yet (it starts the flow asynchronously).
      return this.awaiting(ticketId, pending)
    }

    // Re-authentication. Only a code that came and went proves the flow ran.
    if (pending.sawPending) {
      this.pending = undefined
      return { id: ticketId, method: { kind: 'device-request' }, done: true }
    }
    return this.awaiting(ticketId, pending)
  }

  /**
   * Keep a ticket open while its code has not been published yet.
   *
   * Returns the last known instruction so the UI does not blank out between
   * polls; the caller keeps polling until `done` or the deadline.
   *
   * @param ticketId - the ticket to keep open.
   * @param pending - the ticket's bookkeeping.
   * @returns a not-yet-done ticket.
   */
  private awaiting(ticketId: string, pending: PendingTicket): LoginTicket {
    return {
      id: ticketId,
      method: { kind: 'device-request' },
      done: false,
      // The deadline travels with the method so the UI can stop a spinner that
      // will never resolve.
      ...(Date.parse(pending.expiresAt) <= Date.now() ? { error: '设备码已过期' } : {}),
    }
  }

  /** Build one terminal ticket. */
  private settled(ticketId: string, error: string): LoginTicket {
    return { id: ticketId, method: { kind: 'device-request' }, done: true, error }
  }

  /**
   * Read Grok's weekly allowance from the shared snapshot.
   *
   * The collector reads the `grok` row through {@link createGrokQuotaReader},
   * which goes through this same service, so the snapshot already carries the
   * service's own reading — refreshing under the lock and all. Reading the
   * service a second time here would double the upstream traffic for no gain and
   * could report a different moment than the ring beside it.
   *
   * @returns the quota row; never throws.
   */
  async quota(): Promise<ProviderQuota> {
    try {
      const snapshot = await this.readSnapshot()
      const found = snapshot.providers.find(provider => provider.id === ID)
      return found ?? {
        id: ID,
        name: NAME,
        status: 'error',
        windows: [],
        error: 'grok 不在额度快照中（采集器未注册该 provider）',
        fetchedAt: Date.now(),
      }
    } catch (error) {
      return { id: ID, name: NAME, status: 'error', windows: [], error: reasonOf(error), fetchedAt: Date.now() }
    }
  }
}
