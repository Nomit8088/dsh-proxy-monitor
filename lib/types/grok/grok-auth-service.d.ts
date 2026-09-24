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
import { spawn } from 'node:child_process';
import type { CredentialRef } from '@deepseek-ai/dsh-credentials';
import type { GrokAuthFile } from './grok-auth.js';
import type { GrokAuthLoginMode, GrokAuthStatusView, GrokLoginStartView, GrokUsageView } from './rpc-contract.js';
export type { GrokAuthLoginMode, GrokAuthStatusView, GrokLoginStartView, GrokUsageView } from './rpc-contract.js';
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
    logger: {
        warn(message: string, ...args: unknown[]): void;
    };
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
    effect(callback: () => () => void, label?: string): void;
}
/** Options one service instance is constructed with. */
export interface GrokAuthServiceOptions {
    /** The Grok auth file path (`~/.grok/auth.json` by default). */
    authJsonPath: string;
    /** The grok CLI command to spawn for browser login and version probing. */
    grokCommand: string;
    /** The value-free CredentialRef advertised by status surfaces. */
    credentialRef: CredentialRef;
    /** Lead time before access-token expiry that triggers refresh. */
    refreshLeadMs?: number;
    /** Injectable OAuth/usage transport; defaults to the Host's fetch. */
    fetchImpl?: typeof fetch;
    /** Host-owned deadline for the best-effort usage probe; primarily injectable for tests. */
    usageTimeoutMs?: number;
    /** Maximum teardown wait for abortable auth work; atomic commits always drain. */
    disposeTimeoutMs?: number;
    /** Injectable atomic auth-file writer; defaults to the production writer. */
    authFileWriter?: (path: string, file: GrokAuthFile) => Promise<void>;
    /** Injectable process spawner for CLI lifecycle tests. */
    spawnImpl?: typeof spawn;
    /** Grace period before a stuck CLI probe is force-stopped. */
    probeStopTimeoutMs?: number;
    /** Floor for one device-code poll interval; injectable so tests do not sleep. */
    devicePollMinIntervalMs?: number;
}
/** Host-only credential facts returned at an authenticated operation boundary. */
export interface GrokCredential {
    accessToken: string;
    /** Account email recorded by the official CLI; an identity fact, never a credential. */
    email?: string;
}
/**
 * The Grok login coordinator. Owned by this plugin as a plain object rather
 * than as a cordis service, so it does not collide with the standalone
 * `dsh-grok-auth` plugin's `grokAuth` registration while both are mounted.
 */
export declare class GrokAuthService {
    private readonly options;
    private readonly ctx;
    private grokVersion;
    private lastStatus;
    private readonly statusListeners;
    private cachedCredential;
    private refreshTimer;
    private credentialFlight;
    private backgroundRefreshFlight;
    private deviceLoginFlight;
    private pendingDeviceLogin;
    private lastLoginError;
    private readonly commitFlights;
    private readonly lifecycleAbort;
    private disposed;
    private statusReadAt;
    constructor(ctx: GrokServiceHost, options: GrokAuthServiceOptions);
    /** DSH-side writer-lock target; the CLI's own `auth.json.lock` is never touched. */
    private get lockTarget();
    private disposeOperations;
    /** Whether the grok CLI resolved at startup (device-code login works without it). */
    get available(): boolean;
    /** Last locally observed value-free status, when one has been read. */
    get cachedStatus(): GrokAuthStatusView | undefined;
    /** Observe locally verified status changes without exposing credentials. */
    watchStatus(listener: () => void): () => void;
    /**
     * Resolve credentials for one authenticated operation. A fresh cached
     * credential with an untouched auth file is served directly (one stat, no
     * read, no lock); everything else shares one in-process flight, which
     * re-reads under the cross-process writer lock before deciding whether to
     * refresh.
     */
    credential(signal?: AbortSignal): Promise<GrokCredential | undefined>;
    /**
     * Whether a cached credential may still be served: the token must remain
     * comfortably valid, the entry must be younger than the cache ceiling, and
     * the auth file must not have changed under it (a `grok login` re-run or
     * another process's refresh). The file check is one stat — no read, no lock.
     */
    private cachedCredentialFresh;
    /** Describe the current login state without exposing any token material. */
    status(): Promise<GrokAuthStatusView>;
    /**
     * Read-only weekly usage snapshot for the settings login block. The Grok
     * proxy backend's billing endpoint answers the account's weekly credit
     * usage percentage and period end. The probe never throws: a failure
     * answers an empty view, which the settings card renders as dashes instead
     * of erroring the whole login block.
     */
    usage(signal?: AbortSignal): Promise<GrokUsageView>;
    /**
     * Start one login flow. Browser mode spawns the official grok CLI in the
     * background and the CLI owns the whole flow; device mode runs RFC 8628
     * against auth.x.ai inside the Host and answers the code to show the user,
     * while a background poll adopts the tokens once the user approves.
     */
    login(mode: GrokAuthLoginMode): Promise<GrokLoginStartView>;
    /** Poll the token endpoint until the device grant is approved, denied, or dead. */
    private pollDeviceLogin;
    /** Fold approved device-login tokens into the auth file under the writer lock. */
    private adoptDeviceLogin;
    /** Record one device-login failure for the status surface. */
    private recordLoginFailure;
    /** Resolve from the latest locked document and refresh at most once. */
    private resolveCredential;
    /**
     * Under the writer lock, read the auth file and return a side-effect-free
     * refresh decision. Callers publish/cache only after their lifecycle check.
     * A token whose expiry cannot be determined refreshes when possible; a due
     * token with no refresh token is served as-is and the backend arbitrates.
     */
    private decideRefreshLocked;
    /**
     * Under the writer lock: fold a refresh reply into the current document,
     * preserving unknown fields — unless another writer already refreshed while
     * the OAuth round trip was in flight, in which case its newer document wins.
     * Returns the document to serve, or `undefined` when the login is gone.
     */
    private adoptRefreshedLocked;
    /** Commit one non-cancellable atomic write while keeping teardown joined. */
    private commitAuthFile;
    /**
     * Populate the in-memory credential cache from a version-bound snapshot and
     * arm the next background refresh. A snapshot failure never produces a cache
     * entry, so filesystem uncertainty fails closed.
     */
    private recordResolved;
    /**
     * Arm one background refresh at the access-token expiry minus the refresh
     * lead, with a grace lead, and never closer than the minimum delay unless a
     * refresh is already due (then it fires immediately). The timer is unref'd
     * so it never keeps the process alive, and is cleared on dispose.
     */
    private scheduleBackgroundRefresh;
    /** Start or join the one lifecycle-tracked background refresh flight. */
    private startBackgroundRefresh;
    /**
     * Refresh the token set ahead of the request path when the auth file says it
     * is due. The request path still refreshes synchronously when a token is
     * genuinely needed, but this pre-arms it while the process is alive, so the
     * common case never waits on the OAuth round trip. Like the request path,
     * the OAuth round trip happens outside the writer lock (short critical
     * sections only), so a slow token endpoint never blocks other readers;
     * failures are logged and retried later.
     */
    private refreshInBackground;
    private clearRefreshTimer;
    /** Re-arm the background refresh after a failure. */
    private scheduleBackgroundRetry;
    /** The status view of one auth document plus this service's live login facts. */
    private statusFromFile;
    private publishStatus;
    private warnCredentialFailure;
    /**
     * Probe the grok CLI once at startup without blocking the event loop;
     * failures (missing binary, timeout, non-zero exit) leave browser login
     * unavailable while device-code login keeps working.
     */
    private probeGrok;
}
/** Extract the settings-relevant facts from a Grok billing payload, or none. */
export declare function usageFromPayload(value: unknown): GrokUsageView;
