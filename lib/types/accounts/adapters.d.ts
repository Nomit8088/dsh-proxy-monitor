/**
 * Account adapters for the four reverse-proxied providers.
 *
 * Each adapter reads through the shared quota snapshot the collector already
 * caches and coalesces, rather than probing a provider directly. That is not
 * only cheaper — it is the correctness argument: the credential that authorizes
 * a quota read *is* the credential `account()` reports on, so deriving one from
 * the other makes disagreement impossible. A provider that answers
 * `unconfigured` cannot simultaneously claim to be signed in.
 *
 * ## What is real here, and what is still scaffolding
 *
 * `account()` and `quota()` are fully wired: the account block in the rail and
 * the settings page read live state today.
 *
 * `login` reports `kind: 'none'` for three providers **for now**. That is a
 * deliberate placeholder, not a claim that they cannot be signed in to — each
 * owns a real flow upstream (ChatGPT OAuth for Codex, Google OAuth for
 * Antigravity, the desktop app's session for WorkBuddy). Those flows arrive one
 * provider at a time as the merge proceeds, and each replaces this placeholder
 * with a real `beginLogin`/`pollLogin` pair. Until then the UI correctly renders
 * no button rather than one that would fail. Grok is already past this stage and
 * lives in `./grok.ts`.
 *
 * @module @dsh-external/dsh-proxy-monitor/accounts/adapters
 */
import type { ProviderQuota, QuotaSnapshot } from '../contract.js';
import type { AccountAdapter, LoginMethod, ProviderAccount, ProxiedProviderId } from './contract.js';
/**
 * Map one quota read onto the account face.
 *
 * The mapping is intentionally total: every {@link ProviderQuota} status has an
 * account counterpart, so no state can fall through to a default that would
 * misreport it.
 *
 * @param id - provider the read belongs to.
 * @param name - display name for the account row.
 * @param quota - the quota row the read produced.
 * @param login - the login method to offer; defaults to the pending placeholder.
 * @returns the account row.
 */
export declare function accountFromQuota(id: ProxiedProviderId, name: string, quota: ProviderQuota, login?: LoginMethod, canLogout?: boolean, canReauth?: boolean): ProviderAccount;
/**
 * Build the snapshot-backed adapters for the providers whose login is not yet
 * migrated.
 *
 * Grok is deliberately absent: it has a real adapter
 * ({@link GrokAccountAdapter}) because its device-code flow can run entirely
 * inside the Host. Keeping the split explicit — rather than a list with a hole
 * patched at runtime — means the set of "providers with a real login" is
 * readable from the imports.
 *
 * @param readSnapshot - reads the collector's current snapshot.
 * @returns one adapter each for Codex, Antigravity, and WorkBuddy.
 */
export declare function createQuotaBackedAdapters(readSnapshot: () => Promise<QuotaSnapshot>): AccountAdapter[];
