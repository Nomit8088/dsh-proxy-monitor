/**
 * The `grokAuth` service: login status and login-flow startup for the web
 * surface. Status is value-free (no token material ever leaves this service),
 * and login either spawns the official grok CLI (browser flow, which owns the
 * whole PKCE dance) or runs the RFC 8628 device-code flow inside the Host,
 * surfacing only the user code and verification link.
 *
 * Authenticated operations resolve credentials through an in-memory cache
 * that is validated per call with a single stat: a fresh token with an
 * untouched auth file is served without any file read or cross-process lock.
 * Refresh happens proactively in the background (ahead of the ~6-hour Grok
 * token expiry), so the request path only refreshes synchronously when a
 * token is genuinely needed — after long process-down idle, or when a refresh
 * failed and the token is still required.
 *
 * @module dsh-grok-auth/grok-auth-service
 */

import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  authState, DEFAULT_REFRESH_LEAD_MS, dshLockTargetFor, expiryUnknown, mergeDeviceLogin, mergeRefreshed,
  needsRefresh, pollDeviceToken, readAuthFile, readAuthFileVersion, readAuthSnapshot, refreshTokenOf,
  refreshTokens, requestDeviceCode, sameAuthFileVersion, writeAuthFile,
} from './grok-auth.js'
import type {
  GrokAuthFile, GrokAuthFileVersion, GrokAuthSnapshot, GrokDeviceAuthorization, GrokTokenReply,
} from './grok-auth.js'
import { readBoundedResponseText } from './bounded-response.js'
import type {
  GrokAuthLoginMode, GrokAuthStatusView, GrokLoginStartView, GrokPendingLoginView, GrokUsageView,
} from './rpc-contract.js'
export type { GrokAuthLoginMode, GrokAuthStatusView, GrokLoginStartView, GrokUsageView } from './rpc-contract.js'

/**
 * The narrow host surface {@link GrokAuthService} needs.
 *
 * Declared structurally rather than as a cordis `Context` so the service can be
 * constructed without being a cordis `Service`. That decoupling is load-bearing
 * for the merge: the standalone `dsh-grok-auth` plugin registers a cordis
 * service named `grokAuth`, so a ported `Service` subclass here would collide
 * with it while both are mounted. Taking only the two capabilities the service
 * actually uses — a logger and an effect hook — leaves it free to be a plain
 * object owned by this plugin.
 */
export interface GrokServiceHost {
  /** Non-fatal diagnostic sink. */
  logger: { warn(message: string, ...args: unknown[]): void }
  /**
   * Register a lifecycle callback whose returned disposer runs when the owner
   * unloads.
   *
   * The callback must return a disposer: this mirrors cordis's own `effect`
   * signature exactly, so passing `ctx.effect` straight through typechecks and
   * an effect can never be registered without a way to undo it.
   *
   * @param callback - returns the disposer for whatever it registered.
   * @param label - diagnostic label for the registration.
   */
  effect(callback: () => () => void, label?: string): void
}

/** Options one service instance is constructed with. */
export interface GrokAuthServiceOptions {
  /** The Grok auth file path (`~/.grok/auth.json` by default). */
  authJsonPath: string
  /** The grok CLI command to spawn for browser login and version probing. */
  grokCommand: string
  /** The value-free CredentialRef advertised by status surfaces. */
  credentialRef: CredentialRef
  /** Lead time before access-token expiry that triggers refresh. */
  refreshLeadMs?: number
  /** Injectable OAuth/usage transport; defaults to the Host's fetch. */
  fetchImpl?: typeof fetch
  /** Host-owned deadline for the best-effort usage probe; primarily injectable for tests. */
  usageTimeoutMs?: number
  /** Maximum teardown wait for abortable auth work; atomic commits always drain. */
  disposeTimeoutMs?: number
  /** Injectable atomic auth-file writer; defaults to the production writer. */
  authFileWriter?: (path: string, file: GrokAuthFile) => Promise<void>
  /** Injectable process spawner for CLI lifecycle tests. */
  spawnImpl?: typeof spawn
  /** Grace period before a stuck CLI probe is force-stopped. */
  probeStopTimeoutMs?: number
  /** Floor for one device-code poll interval; injectable so tests do not sleep. */
  devicePollMinIntervalMs?: number
}

/** Host-only credential facts returned at an authenticated operation boundary. */
export interface GrokCredential {
  accessToken: string
  /** Account email recorded by the official CLI; an identity fact, never a credential. */
  email?: string
}

/** How long a resolved credential may be served from memory without re-reading the auth file. */
const CREDENTIAL_CACHE_MAX_AGE_MS = 10 * 60 * 1000

/** How long a computed status may be served without re-reading the auth file. */
const STATUS_CACHE_TTL_MS = 2_000

/** Lead before the refresh threshold at which the background refresh timer fires. */
const REFRESH_GRACE_MS = 60 * 1000

/** Retry interval after a failed background refresh. */
const BACKGROUND_REFRESH_RETRY_MS = 5 * 60 * 1000

/** Maximum unload wait after signalling cancellation to abortable auth work. */
const DISPOSE_TIMEOUT_MS = 5_000

/** Floor for a background refresh that is not yet due; avoids a zero-delay re-arm loop. */
const BACKGROUND_REFRESH_MIN_DELAY_MS = 60 * 1000

/** Ceiling for one setTimeout delay (Node's 32-bit signed millisecond cap). */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/** grok CLI version probe timeout. */
const PROBE_TIMEOUT_MS = 5_000

/** Grace before a stopping CLI probe is detached and force-killed. */
const PROBE_STOP_TIMEOUT_MS = 500

/** Default device-code poll interval when the endpoint names none (RFC 8628). */
const DEVICE_POLL_DEFAULT_INTERVAL_MS = 5_000

/** Additional wait added on a valueless `slow_down` reply (RFC 8628). */
const DEVICE_POLL_SLOW_DOWN_STEP_MS = 5_000

/** Read-only Grok backend endpoint answering the account's weekly credit usage. */
const GROK_USAGE_ENDPOINT = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'

/** The token-channel marker the official grok CLI sends to its proxy backend. */
const GROK_USAGE_TOKEN_HEADER = 'xai-grok-cli'

/** Hard cap for the usage envelope; the real payload is a few hundred bytes. */
const GROK_USAGE_MAX_BYTES = 64 * 1024

/** Host-owned deadline so a stalled private endpoint cannot pin the RPC forever. */
const GROK_USAGE_TIMEOUT_MS = 10_000

/** The weekly billing period marker in the usage payload. */
const WEEKLY_USAGE_PERIOD_TYPE = 'USAGE_PERIOD_TYPE_WEEKLY'

/** One resolved credential plus the facts that decide whether it may be served again. */
interface CachedCredential {
  credential: GrokCredential
  /** The access token's expiry in epoch milliseconds, when determinable. */
  accessTokenExpiresAt: number | undefined
  /** When this entry was resolved. */
  cachedAt: number
  /** Exact version of the auth-file inode whose bytes produced this credential. */
  fileVersion: GrokAuthFileVersion
}

/** One in-flight device-code login the status surface may describe. */
interface PendingDeviceLogin {
  userCode: string
  verificationUri: string
  expiresAt: number
}

/**
 * The Grok login coordinator. Owned by this plugin as a plain object rather
 * than as a cordis service, so it does not collide with the standalone
 * `dsh-grok-auth` plugin's `grokAuth` registration while both are mounted.
 */
export class GrokAuthService {
  private readonly ctx: GrokServiceHost
  private grokVersion: string | undefined
  private lastStatus: GrokAuthStatusView | undefined
  private readonly statusListeners = new Set<() => void>()
  private cachedCredential: CachedCredential | undefined
  private refreshTimer: NodeJS.Timeout | undefined
  private credentialFlight: Promise<GrokCredential | undefined> | undefined
  private backgroundRefreshFlight: Promise<void> | undefined
  private deviceLoginFlight: Promise<void> | undefined
  private pendingDeviceLogin: PendingDeviceLogin | undefined
  private lastLoginError: string | undefined
  private readonly commitFlights = new Set<Promise<void>>()
  private readonly lifecycleAbort = new AbortController()
  private disposed = false
  private statusReadAt = 0

  constructor(ctx: GrokServiceHost, private readonly options: GrokAuthServiceOptions) {
    this.ctx = ctx
    this.probeGrok()
    this.ctx.effect(() => () => this.disposeOperations(), 'grok-auth: operations')
  }

  /** DSH-side writer-lock target; the CLI's own `auth.json.lock` is never touched. */
  private get lockTarget(): string {
    return dshLockTargetFor(this.options.authJsonPath)
  }

  private async disposeOperations(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.clearRefreshTimer()
    this.statusListeners.clear()
    this.cachedCredential = undefined
    this.pendingDeviceLogin = undefined
    this.lifecycleAbort.abort(new Error('grok-auth: auth operation cancelled during disposal'))

    const operations: Promise<unknown>[] = [
      ...(this.credentialFlight === undefined ? [] : [this.credentialFlight]),
      ...(this.backgroundRefreshFlight === undefined ? [] : [this.backgroundRefreshFlight]),
      ...(this.deviceLoginFlight === undefined ? [] : [this.deviceLoginFlight]),
    ]
    if (operations.length > 0) {
      const timeoutMs = this.options.disposeTimeoutMs ?? DISPOSE_TIMEOUT_MS
      const drain = Promise.allSettled(operations).then(() => {})
      if (!await waitForSettlement(drain, timeoutMs)) {
        this.ctx.logger.warn(
          'grok-auth: abortable auth work did not stop within %dms; disposal will continue',
          timeoutMs,
        )
      }
    }
    this.credentialFlight = undefined

    // Once an atomic commit starts it is not cancellable. Keep teardown joined
    // to it so no auth-file mutation can finish after the module is disposed.
    if (this.commitFlights.size > 0) await Promise.allSettled(this.commitFlights)
  }

  /** Whether the grok CLI resolved at startup (device-code login works without it). */
  get available(): boolean {
    return this.grokVersion !== undefined
  }

  /** Last locally observed value-free status, when one has been read. */
  get cachedStatus(): GrokAuthStatusView | undefined {
    return this.lastStatus
  }

  /** Observe locally verified status changes without exposing credentials. */
  watchStatus(listener: () => void): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  /**
   * Resolve credentials for one authenticated operation. A fresh cached
   * credential with an untouched auth file is served directly (one stat, no
   * read, no lock); everything else shares one in-process flight, which
   * re-reads under the cross-process writer lock before deciding whether to
   * refresh.
   */
  async credential(signal?: AbortSignal): Promise<GrokCredential | undefined> {
    throwIfAborted(signal)
    if (this.disposed) return undefined
    const cached = this.cachedCredential
    if (cached !== undefined) {
      const fresh = await this.cachedCredentialFresh(cached)
      if (this.disposed) return undefined
      if (fresh) return cached.credential
    }
    let flight = this.credentialFlight
    if (flight === undefined) {
      flight = this.resolveCredential(this.lifecycleAbort.signal).finally(() => {
        if (this.credentialFlight === flight) this.credentialFlight = undefined
      })
      this.credentialFlight = flight
    }
    return waitForCredential(flight, signal, this.lifecycleAbort.signal)
  }

  /**
   * Whether a cached credential may still be served: the token must remain
   * comfortably valid, the entry must be younger than the cache ceiling, and
   * the auth file must not have changed under it (a `grok login` re-run or
   * another process's refresh). The file check is one stat — no read, no lock.
   */
  private async cachedCredentialFresh(cached: CachedCredential): Promise<boolean> {
    const leadMs = this.options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS
    if (cached.accessTokenExpiresAt === undefined) return false
    if (cached.accessTokenExpiresAt - Date.now() < leadMs) return false
    if (Date.now() - cached.cachedAt >= CREDENTIAL_CACHE_MAX_AGE_MS) return false
    try {
      const current = await readAuthFileVersion(this.options.authJsonPath)
      return current !== undefined && sameAuthFileVersion(current, cached.fileVersion)
    } catch {
      return false
    }
  }

  /** Describe the current login state without exposing any token material. */
  async status(): Promise<GrokAuthStatusView> {
    if (this.lastStatus !== undefined && Date.now() - this.statusReadAt < STATUS_CACHE_TTL_MS) {
      return this.lastStatus
    }
    let file: GrokAuthFile | undefined
    try {
      file = await readAuthFile(this.options.authJsonPath)
    } catch (error) {
      if (!this.disposed) this.warnCredentialFailure('status could not read the Grok Login State', error)
    }
    const status = this.statusFromFile(file)
    if (this.disposed) return status
    this.statusReadAt = Date.now()
    return this.publishStatus(status)
  }

  /**
   * Read-only weekly usage snapshot for the settings login block. The Grok
   * proxy backend's billing endpoint answers the account's weekly credit
   * usage percentage and period end. The probe never throws: a failure
   * answers an empty view, which the settings card renders as dashes instead
   * of erroring the whole login block.
   */
  async usage(signal?: AbortSignal): Promise<GrokUsageView> {
    const bounded = boundedSignal(
      [signal, this.lifecycleAbort.signal],
      this.options.usageTimeoutMs ?? GROK_USAGE_TIMEOUT_MS,
    )
    try {
      throwIfAborted(bounded.signal)
      const credential = await this.credential(bounded.signal)
      if (credential === undefined) return {}
      return await waitForAbort(
        probeUsage(this.options.fetchImpl ?? fetch, credential, bounded.signal),
        bounded.signal,
      )
    } catch {
      // Best-effort probe: login problems, network failures, malformed
      // envelopes, and cancellation all degrade to an empty view.
      return {}
    } finally {
      bounded.cleanup()
    }
  }

  /**
   * Start one login flow. Browser mode spawns the official grok CLI in the
   * background and the CLI owns the whole flow; device mode runs RFC 8628
   * against auth.x.ai inside the Host and answers the code to show the user,
   * while a background poll adopts the tokens once the user approves.
   */
  async login(mode: GrokAuthLoginMode): Promise<GrokLoginStartView> {
    if (this.disposed) throw new Error('grok-auth: the service is disposed')
    if (mode === 'browser') {
      if (!this.available) {
        throw new Error(
          `grok-auth: the grok CLI ("${this.options.grokCommand}") is not on PATH; `
          + 'install it (or use the device-code login) before logging in',
        )
      }
      try {
        const child = (this.options.spawnImpl ?? spawn)(
          this.options.grokCommand, ['login'], { detached: true, stdio: 'ignore' },
        )
        child.unref()
        return { started: true }
      } catch (error) {
        throw new Error(
          `grok-auth: failed to start ${this.options.grokCommand} login: `
          + (error instanceof Error ? error.message : String(error)),
        )
      }
    }
    const pending = this.pendingDeviceLogin
    if (pending !== undefined && this.deviceLoginFlight !== undefined && pending.expiresAt > Date.now()) {
      return {
        started: true,
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
        expiresInSeconds: Math.max(1, Math.round((pending.expiresAt - Date.now()) / 1000)),
      }
    }
    this.lastLoginError = undefined
    const device = await requestDeviceCode(this.options.fetchImpl ?? fetch, this.lifecycleAbort.signal)
    if (this.disposed) throw new Error('grok-auth: the service is disposed')
    this.pendingDeviceLogin = {
      userCode: device.userCode,
      verificationUri: device.verificationUriComplete ?? device.verificationUri,
      expiresAt: Date.now() + device.expiresInSeconds * 1000,
    }
    this.statusReadAt = 0
    const flight = this.pollDeviceLogin(device, this.lifecycleAbort.signal).finally(() => {
      if (this.deviceLoginFlight === flight) this.deviceLoginFlight = undefined
    })
    this.deviceLoginFlight = flight
    return {
      started: true,
      userCode: device.userCode,
      verificationUri: device.verificationUriComplete ?? device.verificationUri,
      expiresInSeconds: device.expiresInSeconds,
    }
  }

  /** Poll the token endpoint until the device grant is approved, denied, or dead. */
  private async pollDeviceLogin(device: GrokDeviceAuthorization, signal: AbortSignal): Promise<void> {
    const minIntervalMs = this.options.devicePollMinIntervalMs ?? 0
    let intervalMs = Math.max(
      minIntervalMs,
      device.intervalSeconds === undefined ? DEVICE_POLL_DEFAULT_INTERVAL_MS : device.intervalSeconds * 1000,
    )
    const deadline = Date.now() + device.expiresInSeconds * 1000
    while (!isAborted(signal) && Date.now() < deadline) {
      await abortableDelay(intervalMs, signal)
      if (isAborted(signal)) return
      let result
      try {
        result = await pollDeviceToken(device.deviceCode, this.options.fetchImpl ?? fetch, signal)
      } catch {
        // Transient transport failure: the grant may still be approved later.
        if (isAborted(signal)) return
        continue
      }
      if (result.status === 'pending') continue
      if (result.status === 'slow_down') {
        intervalMs = Math.max(
          intervalMs + DEVICE_POLL_SLOW_DOWN_STEP_MS,
          result.intervalSeconds === undefined ? 0 : result.intervalSeconds * 1000,
        )
        continue
      }
      if (result.status === 'failed') {
        this.recordLoginFailure(result.message)
        return
      }
      await this.adoptDeviceLogin(result.reply, signal)
      return
    }
    if (!isAborted(signal) && this.pendingDeviceLogin !== undefined) {
      this.recordLoginFailure('device code expired before it was approved')
    }
  }

  /** Fold approved device-login tokens into the auth file under the writer lock. */
  private async adoptDeviceLogin(reply: GrokTokenReply, signal: AbortSignal): Promise<void> {
    try {
      const adopted = await withFileLock(this.lockTarget, async () => {
        if (isAborted(signal)) return undefined
        const current = await readAuthFile(this.options.authJsonPath).catch(() => undefined)
        if (!await this.commitAuthFile(mergeDeviceLogin(current, reply), signal)) return undefined
        return readAuthSnapshot(this.options.authJsonPath)
      })
      if (isAborted(signal) || adopted === undefined) return
      this.pendingDeviceLogin = undefined
      this.lastLoginError = undefined
      this.statusReadAt = 0
      this.publishStatus(this.statusFromFile(adopted.file))
      this.recordResolved(adopted)
    } catch (error) {
      if (isAborted(signal)) return
      this.warnCredentialFailure('device login could not persist the Grok Login State', error)
      this.recordLoginFailure('persisting the approved login failed')
    }
  }

  /** Record one device-login failure for the status surface. */
  private recordLoginFailure(message: string): void {
    if (this.disposed) return
    this.pendingDeviceLogin = undefined
    this.lastLoginError = message
    this.statusReadAt = 0
    this.ctx.logger.warn('grok-auth: device login failed (%s)', message)
    for (const listener of this.statusListeners) {
      try { listener() } catch { /* one observer cannot disrupt auth */ }
    }
  }

  /** Resolve from the latest locked document and refresh at most once. */
  private async resolveCredential(signal: AbortSignal): Promise<GrokCredential | undefined> {
    let observed: GrokAuthFile | undefined
    try {
      observed = await readAuthFile(this.options.authJsonPath)
      if (isAborted(signal)) return undefined
    } catch (error) {
      if (isAborted(signal)) return undefined
      // The pre-lock read is only a hint: another DSH process or the grok CLI
      // may replace a missing or malformed document before this process owns the lock.
      this.warnCredentialFailure('pre-lock read could not inspect the Grok Login State', error)
    }

    try {
      // Phase 1 — decide under the writer lock whether a refresh is due. The
      // OAuth round trip happens OUTSIDE the lock (phase 2), so a slow token
      // endpoint never blocks other credential readers or the background
      // refresher behind the lock's contention deadline.
      const decision = await withFileLock(this.lockTarget, () => this.decideRefreshLocked())
      if (isAborted(signal)) return undefined
      if (decision.mode === 'absent') {
        this.publishStatus(this.statusFromFile(decision.file))
        return undefined
      }
      if (decision.mode === 'ready') {
        this.publishStatus(this.statusFromFile(decision.snapshot.file))
        this.recordResolved(decision.snapshot)
        return credentialFromFile(decision.snapshot.file)
      }
      try {
        const reply = await refreshTokens(decision.refreshToken, this.options.fetchImpl ?? fetch, signal)
        if (isAborted(signal)) return undefined
        const adopted = await withFileLock(
          this.lockTarget,
          () => this.adoptRefreshedLocked(decision.snapshot.file, reply, signal),
        )
        if (isAborted(signal) || adopted === undefined) return undefined
        this.publishStatus(this.statusFromFile(adopted.file))
        this.recordResolved(adopted)
        return credentialFromFile(adopted.file)
      } catch (error) {
        if (isAborted(signal)) return undefined
        // The grok CLI does not share this lock. If it rotated the same login
        // while our refresh was in flight, recover from its newer state.
        const replacement = await readAuthSnapshot(this.options.authJsonPath)
        if (isAborted(signal)) return undefined
        const leadMs = this.options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS
        if (canAdoptReplacement(decision.snapshot.file, replacement?.file, leadMs)) {
          this.publishStatus(this.statusFromFile(replacement.file))
          this.recordResolved(replacement)
          return credentialFromFile(replacement.file)
        }
        this.warnCredentialFailure(
          'token refresh failed; run `grok login` (or the Grok Auth settings card) to restore the Grok Login State',
          error,
        )
        this.publishStatus(this.statusFromFile(replacement?.file))
        return undefined
      }
    } catch (error) {
      if (isAborted(signal)) return undefined
      this.warnCredentialFailure('could not coordinate the Grok Login State', error)
      // `observed` was only the pre-lock hint; nothing to serve from it safely.
      void observed
      return undefined
    }
  }

  /**
   * Under the writer lock, read the auth file and return a side-effect-free
   * refresh decision. Callers publish/cache only after their lifecycle check.
   * A token whose expiry cannot be determined refreshes when possible; a due
   * token with no refresh token is served as-is and the backend arbitrates.
   */
  private async decideRefreshLocked(): Promise<
    | { mode: 'absent'; file: GrokAuthFile | undefined }
    | { mode: 'ready'; snapshot: GrokAuthSnapshot }
    | { mode: 'refresh'; snapshot: GrokAuthSnapshot; refreshToken: string }
  > {
    const snapshot = await readAuthSnapshot(this.options.authJsonPath)
    if (snapshot === undefined) return { mode: 'absent', file: undefined }
    const file = snapshot.file
    const state = authState(file)
    if (state.accessToken === undefined) return { mode: 'absent', file }
    const leadMs = this.options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS
    const due = needsRefresh(state, leadMs) || expiryUnknown(state)
    if (!due) return { mode: 'ready', snapshot }
    const refreshToken = refreshTokenOf(state.entry)
    if (refreshToken === undefined) return { mode: 'ready', snapshot }
    return { mode: 'refresh', snapshot, refreshToken }
  }

  /**
   * Under the writer lock: fold a refresh reply into the current document,
   * preserving unknown fields — unless another writer already refreshed while
   * the OAuth round trip was in flight, in which case its newer document wins.
   * Returns the document to serve, or `undefined` when the login is gone.
   */
  private async adoptRefreshedLocked(
    previous: GrokAuthFile,
    reply: GrokTokenReply,
    signal?: AbortSignal,
  ): Promise<GrokAuthSnapshot | undefined> {
    if (isAborted(signal)) return undefined
    const current = await readAuthSnapshot(this.options.authJsonPath)
    if (isAborted(signal) || current === undefined) return undefined
    const currentState = authState(current.file)
    const leadMs = this.options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS
    if (currentState.accessToken !== undefined
      && !needsRefresh(currentState, leadMs) && !expiryUnknown(currentState)) {
      return current
    }
    if (!sameRefreshLineage(previous, current.file)) {
      this.publishStatus(this.statusFromFile(current.file))
      return undefined
    }
    const entryKey = currentState.entryKey
    if (entryKey === undefined) return undefined
    if (!await this.commitAuthFile(mergeRefreshed(current.file, entryKey, reply), signal)) return undefined
    if (isAborted(signal)) return undefined
    const persisted = await readAuthSnapshot(this.options.authJsonPath)
    if (persisted === undefined) return undefined
    const persistedState = authState(persisted.file)
    if (persistedState.accessToken === undefined
      || needsRefresh(persistedState, leadMs) || expiryUnknown(persistedState)) return undefined
    return persisted
  }

  /** Commit one non-cancellable atomic write while keeping teardown joined. */
  private async commitAuthFile(file: GrokAuthFile, signal?: AbortSignal): Promise<boolean> {
    if (isAborted(signal)) return false
    const writer = this.options.authFileWriter ?? writeAuthFile
    const commit = Promise.resolve().then(() => writer(this.options.authJsonPath, file))
    this.commitFlights.add(commit)
    try {
      await commit
      return !isAborted(signal)
    } finally {
      this.commitFlights.delete(commit)
    }
  }

  /**
   * Populate the in-memory credential cache from a version-bound snapshot and
   * arm the next background refresh. A snapshot failure never produces a cache
   * entry, so filesystem uncertainty fails closed.
   */
  private recordResolved(snapshot: GrokAuthSnapshot): void {
    if (this.disposed) return
    const credential = credentialFromFile(snapshot.file)
    if (credential === undefined) {
      this.cachedCredential = undefined
      return
    }
    this.cachedCredential = {
      credential,
      accessTokenExpiresAt: authState(snapshot.file).accessTokenExpiresAt,
      cachedAt: Date.now(),
      fileVersion: snapshot.version,
    }
    this.scheduleBackgroundRefresh(snapshot.file)
  }

  /**
   * Arm one background refresh at the access-token expiry minus the refresh
   * lead, with a grace lead, and never closer than the minimum delay unless a
   * refresh is already due (then it fires immediately). The timer is unref'd
   * so it never keeps the process alive, and is cleared on dispose.
   */
  private scheduleBackgroundRefresh(file: GrokAuthFile): void {
    // Every resolved snapshot supersedes the previous schedule. This matters
    // when the grok CLI writes a login whose token expires sooner.
    this.clearRefreshTimer()
    if (this.disposed) return
    const state = authState(file)
    if (refreshTokenOf(state.entry) === undefined) return
    const now = Date.now()
    const leadMs = this.options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS
    if (state.accessTokenExpiresAt === undefined) return
    const delayMs = state.accessTokenExpiresAt - now - leadMs - REFRESH_GRACE_MS
    const due = needsRefresh(state, leadMs)
    const delay = due
      ? 0
      : Math.max(BACKGROUND_REFRESH_MIN_DELAY_MS, Math.min(delayMs, MAX_TIMER_DELAY_MS))
    const timer = setTimeout(() => {
      this.refreshTimer = undefined
      // Keep the timer callback linked to the lifecycle-tracked operation.
      return this.startBackgroundRefresh()
    }, delay)
    timer.unref?.()
    this.refreshTimer = timer
  }

  /** Start or join the one lifecycle-tracked background refresh flight. */
  private startBackgroundRefresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.backgroundRefreshFlight !== undefined) return this.backgroundRefreshFlight
    const flight = this.refreshInBackground(this.lifecycleAbort.signal).finally(() => {
      if (this.backgroundRefreshFlight === flight) this.backgroundRefreshFlight = undefined
    })
    this.backgroundRefreshFlight = flight
    return flight
  }

  /**
   * Refresh the token set ahead of the request path when the auth file says it
   * is due. The request path still refreshes synchronously when a token is
   * genuinely needed, but this pre-arms it while the process is alive, so the
   * common case never waits on the OAuth round trip. Like the request path,
   * the OAuth round trip happens outside the writer lock (short critical
   * sections only), so a slow token endpoint never blocks other readers;
   * failures are logged and retried later.
   */
  private async refreshInBackground(signal: AbortSignal): Promise<void> {
    let retry = false
    try {
      if (isAborted(signal)) return
      const decision = await withFileLock(this.lockTarget, () => this.decideRefreshLocked())
      if (isAborted(signal)) return
      if (decision.mode === 'absent') {
        this.publishStatus(this.statusFromFile(decision.file))
        return
      }
      if (decision.mode === 'ready') {
        // Already fresh — a request-path refresh won the race, or the login
        // changed under us. Re-arm from the current document.
        this.publishStatus(this.statusFromFile(decision.snapshot.file))
        this.recordResolved(decision.snapshot)
        return
      }
      try {
        const reply = await refreshTokens(decision.refreshToken, this.options.fetchImpl ?? fetch, signal)
        if (isAborted(signal)) return
        const adopted = await withFileLock(
          this.lockTarget,
          () => this.adoptRefreshedLocked(decision.snapshot.file, reply, signal),
        )
        if (isAborted(signal)) return
        if (adopted === undefined) {
          // A successful reply can still be unusable when the CLI changed the
          // refresh-token lineage in flight. Retry from that newer state
          // instead of silently losing proactive refresh.
          retry = true
        } else {
          this.publishStatus(this.statusFromFile(adopted.file))
          this.recordResolved(adopted)
        }
      } catch (error) {
        if (isAborted(signal)) return
        // The grok CLI does not share this lock. If it rotated the same
        // login while our refresh was in flight, adopt its newer state.
        const replacement = await readAuthSnapshot(this.options.authJsonPath)
        if (isAborted(signal)) return
        const leadMs = this.options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS
        if (canAdoptReplacement(decision.snapshot.file, replacement?.file, leadMs)) {
          this.publishStatus(this.statusFromFile(replacement.file))
          this.recordResolved(replacement)
          return
        }
        this.warnCredentialFailure('background token refresh failed; will retry later', error)
        retry = true
      }
    } catch (error) {
      if (isAborted(signal)) return
      this.warnCredentialFailure('background token refresh could not coordinate; will retry later', error)
      retry = true
    }
    if (retry && !this.disposed) this.scheduleBackgroundRetry()
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer === undefined) return
    clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
  }

  /** Re-arm the background refresh after a failure. */
  private scheduleBackgroundRetry(): void {
    if (this.disposed || this.refreshTimer !== undefined) return
    const timer = setTimeout(() => {
      this.refreshTimer = undefined
      // Keep the timer callback linked to the lifecycle-tracked operation.
      return this.startBackgroundRefresh()
    }, BACKGROUND_REFRESH_RETRY_MS)
    timer.unref?.()
    this.refreshTimer = timer
  }

  /** The status view of one auth document plus this service's live login facts. */
  private statusFromFile(file: GrokAuthFile | undefined): GrokAuthStatusView {
    const state = authState(file)
    const entry = state.entry
    let pendingLogin: GrokPendingLoginView | undefined
    const pending = this.pendingDeviceLogin
    if (pending !== undefined && pending.expiresAt > Date.now()) {
      pendingLogin = {
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
        expiresAt: new Date(pending.expiresAt).toISOString(),
      }
    }
    const authMode = nonBlank(entry?.auth_mode)
    const createdAt = nonBlank(entry?.create_time)
    const email = nonBlank(entry?.email)
    return {
      available: this.available,
      configured: state.accessToken !== undefined,
      ...authMode === undefined ? {} : { authMode },
      ...this.grokVersion === undefined ? {} : { grokVersion: this.grokVersion },
      ...state.accessTokenExpiresAt === undefined
        ? {}
        : { tokenExpiresAt: new Date(state.accessTokenExpiresAt).toISOString() },
      ...createdAt === undefined ? {} : { createdAt },
      ...email === undefined ? {} : { email },
      credentialRef: this.options.credentialRef,
      authFileExists: file !== undefined,
      ...pendingLogin === undefined ? {} : { pendingLogin },
      ...this.lastLoginError === undefined ? {} : { lastLoginError: this.lastLoginError },
    }
  }

  private publishStatus(status: GrokAuthStatusView): GrokAuthStatusView {
    if (this.disposed || sameStatus(this.lastStatus, status)) return status
    this.lastStatus = status
    for (const listener of this.statusListeners) {
      try { listener() } catch { /* one observer cannot disrupt auth */ }
    }
    return status
  }

  private warnCredentialFailure(message: string, error: unknown): void {
    this.ctx.logger.warn('grok-auth: %s (%s)', message, safeDiagnostic(error))
  }

  /**
   * Probe the grok CLI once at startup without blocking the event loop;
   * failures (missing binary, timeout, non-zero exit) leave browser login
   * unavailable while device-code login keeps working.
   */
  private probeGrok(): void {
    this.ctx.effect(() => {
      let child: ReturnType<typeof spawn> | undefined
      let settled = false
      let spawned = false
      let terminal = false
      let stopRequested = false
      let stopSpawnedFlight: Promise<void> | undefined
      let resolveSpawnOutcome!: () => void
      let resolveClosed!: () => void
      const spawnOutcome = new Promise<void>(resolve => { resolveSpawnOutcome = resolve })
      const closed = new Promise<void>(resolve => { resolveClosed = resolve })
      const stopTimeoutMs = this.options.probeStopTimeoutMs ?? PROBE_STOP_TIMEOUT_MS
      const markTerminal = (): void => {
        if (terminal) return
        terminal = true
        resolveSpawnOutcome()
        resolveClosed()
      }
      const detach = (): void => {
        try { child?.stdout?.destroy() } catch { /* best effort */ }
        try { child?.stderr?.destroy() } catch { /* best effort */ }
        try { child?.unref() } catch { /* best effort */ }
      }
      const kill = (signal: NodeJS.Signals): boolean => {
        try { return child?.kill(signal) === true } catch { return false }
      }
      const stopSpawned = (): Promise<void> => {
        if (stopSpawnedFlight !== undefined) return stopSpawnedFlight
        stopSpawnedFlight = (async () => {
          if (terminal) return
          kill('SIGTERM')
          if (await waitForSettlement(closed, stopTimeoutMs)) return
          kill('SIGKILL')
          detach()
          await waitForSettlement(closed, stopTimeoutMs)
        })()
        return stopSpawnedFlight
      }
      const stop = async (): Promise<void> => {
        stopRequested = true
        if (!spawned && !terminal && !await waitForSettlement(spawnOutcome, stopTimeoutMs)) {
          // A pathological spawner produced neither `spawn` nor `error`.
          // Detach its pipes now; a late `spawn` event still triggers stopSpawned.
          detach()
          return
        }
        if (spawned && !terminal) await stopSpawned()
      }
      const finish = (version: string | undefined): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!this.disposed) this.grokVersion = version
      }
      const timer = setTimeout(() => {
        finish(undefined)
        void stop()
      }, PROBE_TIMEOUT_MS)
      timer.unref?.()
      try {
        child = (this.options.spawnImpl ?? spawn)(
          this.options.grokCommand, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        let output = ''
        child.stdout?.on('data', (chunk) => { output += String(chunk) })
        child.stderr?.on('data', (chunk) => { output += String(chunk) })
        child.on('spawn', () => {
          spawned = true
          resolveSpawnOutcome()
          if (stopRequested) void stopSpawned()
        })
        child.on('error', () => {
          finish(undefined)
          if (spawned) void stopSpawned()
          else markTerminal()
        })
        child.on('close', (code) => {
          markTerminal()
          const line = code === 0 ? output.trim().split('\n')[0] : undefined
          finish(typeof line === 'string' && line.length > 0 ? line : undefined)
        })
      } catch {
        markTerminal()
        finish(undefined)
      }
      return async () => {
        settled = true
        clearTimeout(timer)
        await stop()
      }
    }, 'grok-auth: CLI probe')
  }
}

async function probeUsage(
  fetchImpl: typeof fetch,
  credential: GrokCredential,
  signal: AbortSignal,
): Promise<GrokUsageView> {
  const response = await fetchImpl(GROK_USAGE_ENDPOINT, {
    headers: {
      authorization: `Bearer ${credential.accessToken}`,
      'x-xai-token-auth': GROK_USAGE_TOKEN_HEADER,
      accept: 'application/json',
      'user-agent': 'dsh-grok-auth/0.2.0',
    },
    signal,
  })
  if (!response.ok) {
    try { await response.body?.cancel() } catch { /* best effort */ }
    return {}
  }
  const text = await readBoundedResponseText(response, GROK_USAGE_MAX_BYTES, signal, {
    tooLarge: () => new Error('usage response exceeded the encoded size limit'),
    cancelled: () => new Error('usage probe was cancelled'),
  })
  return usageFromPayload(JSON.parse(text) as unknown)
}

function credentialFromFile(file: GrokAuthFile): GrokCredential | undefined {
  const state = authState(file)
  if (state.accessToken === undefined) return undefined
  const email = nonBlank(state.entry?.email)
  return {
    accessToken: state.accessToken,
    ...(email === undefined ? {} : { email }),
  }
}

/**
 * Whether a refresh reply may still be applied: the refresh token that made
 * the decision must still be the one the current document carries — a rotated
 * lineage means another writer signed in or refreshed, and its state wins.
 */
function sameRefreshLineage(previous: GrokAuthFile, current: GrokAuthFile): boolean {
  const previousToken = refreshTokenOf(authState(previous).entry)
  const currentToken = refreshTokenOf(authState(current).entry)
  return previousToken !== undefined && previousToken === currentToken
}

function canAdoptReplacement(
  previous: GrokAuthFile,
  replacement: GrokAuthFile | undefined,
  refreshLeadMs: number,
): replacement is GrokAuthFile {
  if (replacement === undefined) return false
  const before = authState(previous)
  const after = authState(replacement)
  if (before.accessToken === undefined || after.accessToken === undefined) return false
  if (before.accessToken === after.accessToken) return false
  // The replacement must serve the same account entry the decision read.
  if (before.entryKey === undefined || before.entryKey !== after.entryKey) return false
  return !needsRefresh(after, refreshLeadMs) && !expiryUnknown(after)
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Extract the settings-relevant facts from a Grok billing payload, or none. */
export function usageFromPayload(value: unknown): GrokUsageView {
  if (!isRecord(value) || !isRecord(value.config)) return {}
  const config = value.config
  const period = isRecord(config.currentPeriod) ? config.currentPeriod : undefined
  const weekly = period?.type === WEEKLY_USAGE_PERIOD_TYPE
  let weeklyRemainingPercent: number | undefined
  if (typeof config.creditUsagePercent === 'number' && Number.isFinite(config.creditUsagePercent)) {
    weeklyRemainingPercent = Math.min(100, Math.max(0, Math.round(100 - config.creditUsagePercent)))
  } else if (weekly) {
    // The backend omits the field at zero usage (product rows do the same).
    weeklyRemainingPercent = 100
  }
  let weeklyResetAt: string | undefined
  const end = weekly ? period?.end : undefined
  if (typeof end === 'string' && end.length > 0) {
    const reset = new Date(end)
    if (Number.isFinite(reset.getTime())) weeklyResetAt = reset.toISOString()
  }
  return {
    ...weeklyRemainingPercent === undefined ? {} : { weeklyRemainingPercent },
    ...weeklyResetAt === undefined ? {} : { weeklyResetAt },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeDiagnostic(error: unknown): string {
  // Auth-file parse and OAuth errors may echo arbitrary credential text. Keep
  // only an error class and an optional HTTP status rather than guessing which
  // opaque strings are secret.
  const name = error instanceof Error && error.name.length > 0 ? error.name : 'Error'
  const message = error instanceof Error ? error.message : ''
  const status = /(?:HTTP\s*)?([45]\d\d)\b/iu.exec(message)?.[1]
  return status === undefined ? name.slice(0, 80) : `${name.slice(0, 64)} (HTTP ${status})`
}

function sameStatus(left: GrokAuthStatusView | undefined, right: GrokAuthStatusView): boolean {
  if (left === undefined) return false
  return left.available === right.available
    && left.configured === right.configured
    && left.authMode === right.authMode
    && left.grokVersion === right.grokVersion
    && left.tokenExpiresAt === right.tokenExpiresAt
    && left.createdAt === right.createdAt
    && left.email === right.email
    && left.credentialRef === right.credentialRef
    && left.authFileExists === right.authFileExists
    && left.pendingLogin?.userCode === right.pendingLogin?.userCode
    && left.pendingLogin?.expiresAt === right.pendingLogin?.expiresAt
    && left.lastLoginError === right.lastLoginError
}

function waitForSettlement(task: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs))
    timer.unref?.()
    void task.then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function boundedSignal(parents: readonly (AbortSignal | undefined)[], timeoutMs: number): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const active = parents.filter((parent): parent is AbortSignal => parent !== undefined)
  const onParentAbort = (): void => {
    controller.abort(active.find(parent => parent.aborted)?.reason)
  }
  const aborted = active.find(parent => parent.aborted)
  if (aborted !== undefined) controller.abort(aborted.reason)
  else for (const parent of active) parent.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error(`usage probe timed out after ${String(timeoutMs)}ms`)),
    Math.max(1, timeoutMs),
  )
  timer.unref?.()
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      for (const parent of active) parent.removeEventListener('abort', onParentAbort)
    },
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, delayMs))
    timer.unref?.()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason
}

function waitForAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

function waitForCredential(
  flight: Promise<GrokCredential | undefined>,
  signal: AbortSignal | undefined,
  lifecycleSignal: AbortSignal,
): Promise<GrokCredential | undefined> {
  throwIfAborted(signal)
  if (lifecycleSignal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onCallerAbort)
      lifecycleSignal.removeEventListener('abort', onLifecycleAbort)
    }
    const onCallerAbort = (): void => {
      cleanup()
      reject(signal?.reason)
    }
    const onLifecycleAbort = (): void => {
      cleanup()
      resolve(undefined)
    }
    signal?.addEventListener('abort', onCallerAbort, { once: true })
    lifecycleSignal.addEventListener('abort', onLifecycleAbort, { once: true })
    flight.then(
      value => { cleanup(); resolve(value) },
      error => { cleanup(); reject(error) },
    )
  })
}
