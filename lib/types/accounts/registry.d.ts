/**
 * The account-adapter registry: one place every surface reads accounts from.
 *
 * Both browser surfaces — the rail's account block and the settings page's
 * account sections — need the same list, in the same order, with the same
 * failure isolation. Keeping that in one object rather than in each view is
 * what stops the two from disagreeing about which providers exist.
 *
 * Two properties are deliberate:
 *
 * - **A missing adapter is not an error.** The registry is built from whichever
 *   providers this build carries, and the settings page must still render for a
 *   deployment that has none of them. So the construction takes a possibly
 *   empty set and every read degrades to an empty list.
 * - **One broken adapter cannot hide the others.** `accounts()` settles all
 *   adapters and turns a rejection into that provider's own `error` row, the
 *   same failure isolation the quota collector already applies to reads. A
 *   provider whose credential file is corrupt must not blank the page.
 *
 * @module @dsh-external/dsh-proxy-monitor/accounts/registry
 */
import type { AccountAdapter, LoginTicket, ProxiedProviderId, ProviderAccount } from './contract.js';
/**
 * A collection of account adapters, addressable by provider.
 *
 * Constructed once per Host fiber and handed to the RPC handler; it holds no
 * per-call state, so concurrent reads are safe.
 */
export declare class AccountRegistry {
    private readonly adapters;
    /**
     * @param adapters - every adapter this build ships, in display order.
     */
    constructor(adapters: readonly AccountAdapter[]);
    /** The provider ids this registry serves, in construction order. */
    get ids(): readonly ProxiedProviderId[];
    /**
     * One adapter by id.
     * @param id - provider to look up.
     * @returns the adapter, or undefined when this build does not carry it.
     */
    get(id: ProxiedProviderId): AccountAdapter | undefined;
    /**
     * Every account, one row per adapter, in construction order.
     *
     * Never throws and never shortens the list: an adapter that rejects
     * contributes an `error` row under its own name, so the UI can say *which*
     * provider is broken instead of silently dropping it.
     *
     * The row's `id` is stamped from the adapter rather than taken from its
     * answer. Every surface keys its lookup map by `id`, so an adapter that
     * reported the wrong one would show one provider's state under another's
     * name — a silent mismatch with no error to notice. Stamping here makes that
     * impossible regardless of what an adapter returns.
     *
     * @returns one account row per registered adapter.
     */
    accounts(): Promise<ProviderAccount[]>;
    /**
     * Start a login for one provider.
     * @param id - provider to sign in to.
     * @returns the ticket to display, or undefined when the provider has no login.
     */
    beginLogin(id: ProxiedProviderId): Promise<LoginTicket | undefined>;
    /**
     * Continue polling one login attempt.
     * @param id - provider the attempt belongs to.
     * @param ticketId - id returned by {@link beginLogin}.
     * @returns the updated ticket, or undefined when the provider has no login.
     */
    pollLogin(id: ProxiedProviderId, ticketId: string): Promise<LoginTicket | undefined>;
    /**
     * End one provider's session.
     * @param id - provider to sign out of.
     * @returns true when a logout ran; false when the provider has none.
     */
    logout(id: ProxiedProviderId): Promise<boolean>;
}
