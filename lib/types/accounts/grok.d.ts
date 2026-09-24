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
import type { ProviderQuota, QuotaSnapshot } from '../contract.js';
import type { AccountAdapter, LoginTicket, ProviderAccount, ProxiedProviderId } from './contract.js';
import type { GrokAuthService } from '../grok/grok-auth-service.js';
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
export declare function createGrokQuotaReader(service: GrokAuthService): () => Promise<ProviderQuota>;
/**
 * Grok's unified account adapter over the ported auth service.
 *
 * Holds at most one pending login at a time, mirroring the service: the device
 * flow is a singleton upstream, so allowing two here would let the UI show a
 * code that the service had already replaced.
 */
export declare class GrokAccountAdapter implements AccountAdapter {
    private readonly service;
    private readonly readSnapshot;
    readonly id: ProxiedProviderId;
    /** The one login this adapter is currently tracking, if any. */
    private pending;
    /** Monotonic counter for ticket ids; never reused, so a stale poll cannot match. */
    private ticketSeq;
    /**
     * @param service - the ported Grok auth service (owns the credential and lock).
     * @param readSnapshot - reads the collector's current snapshot. Used for
     *   {@link quota} so the rail and the settings panel share one upstream read
     *   instead of each paying for its own; the collector already reads Grok
     *   through this same service, so the bytes are the service's either way.
     */
    constructor(service: GrokAuthService, readSnapshot: () => Promise<QuotaSnapshot>);
    /**
     * Read Grok's login state.
     *
     * `status()` is the authority: `configured` means a usable credential exists,
     * which is exactly `signed-in`. A pending device login is surfaced through the
     * `login` method so the UI can keep showing the code while the user approves.
     *
     * @returns the account row; never throws.
     */
    account(): Promise<ProviderAccount>;
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
    private loginMethodFor;
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
    beginLogin(): Promise<LoginTicket>;
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
    pollLogin(ticketId: string): Promise<LoginTicket>;
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
    private awaiting;
    /** Build one terminal ticket. */
    private settled;
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
    quota(): Promise<ProviderQuota>;
}
