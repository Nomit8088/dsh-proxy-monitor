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

import type { ProviderQuota, QuotaSnapshot } from '../contract.js'
import type { AccountAdapter, LoginMethod, ProviderAccount, ProxiedProviderId } from './contract.js'

/** The login placeholder every provider carries until its flow is migrated. */
const LOGIN_PENDING: LoginMethod = {
  kind: 'none',
  reason: '登录流程将随该提供商的迁移一并接入；当前凭证由既有的登录状态直接读取。',
}

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
export function accountFromQuota(
  id: ProxiedProviderId,
  name: string,
  quota: ProviderQuota,
  login: LoginMethod = LOGIN_PENDING,
  canLogout = false,
  canReauth = false,
): ProviderAccount {
  if (quota.status === 'ok') {
    return {
      id,
      name,
      state: 'signed-in',
      login,
      canLogout,
      canReauth,
      ...(quota.account === undefined ? {} : { account: quota.account }),
    }
  }
  return {
    id,
    name,
    state: quota.status === 'unconfigured' ? 'signed-out' : 'error',
    login,
    canLogout,
    canReauth,
    error: quota.error ?? (quota.status === 'unconfigured' ? '未登录' : '读取失败'),
  }
}

/**
 * Build an adapter whose `account()` is derived from its `quota()` read.
 *
 * Both methods call the same reader, so they cannot disagree; the reader's own
 * failure isolation (it never throws, it returns a typed error row) is what lets
 * both stay total.
 *
 * @param id - provider id, which must match the reader's own `ProviderQuota.id`.
 * @param name - display name.
 * @param read - the provider's quota reader.
 * @param context - host-provided provider dependencies.
 * @param pluginBase - resolves the running DSH web server's origin. A thunk
 *   rather than a string because the port is only known once the web server has
 *   bound, and because it changes if the settings document repoints it.
 * @returns an account adapter for that provider.
 */
/**
 * Build an adapter that reads its state from the shared quota snapshot.
 *
 * Both methods go through one snapshot reader rather than calling the provider's
 * reader directly. Three things follow, and all three matter:
 *
 * - **One upstream read per provider.** The rail and the settings page both
 *   poll, and each would otherwise re-read every provider. The snapshot is
 *   already cached and coalesced by the collector, so routing through it makes
 *   the two surfaces share one read instead of multiplying vendor traffic.
 * - **No disagreement.** `account()` and `quota()` see the same bytes, so the
 *   rail's ring and the settings panel's status cannot come from different
 *   moments.
 * - **Overrides are honoured for free.** A provider whose reader the collector
 *   was given an override for (Grok) is read through that override here too, so
 *   this table cannot silently bypass it.
 *
 * @param id - provider id, which must match the snapshot row's own id.
 * @param name - display name.
 * @param readSnapshot - reads the collector's current snapshot.
 * @returns an account adapter for that provider.
 */
function snapshotBackedAdapter(
  id: ProxiedProviderId,
  name: string,
  readSnapshot: () => Promise<QuotaSnapshot>,
): AccountAdapter {
  // No provider has a logout yet: ending a session means reaching into the
  // provider's own credential store (a rotation, a file delete, a CLI command),
  // and none of that is migrated. Reporting `false` is what stops the UI from
  // offering a button that would silently do nothing — which is exactly what
  // happened the first time this was probed against the real machine, where all
  // four providers read as signed-in.
  const canLogout = false
  // Nor a login: `LOGIN_PENDING` reports `kind: 'none'`, and `canReauth` must
  // agree with it. Claiming re-authentication here would put a "重新登录" button
  // on a provider whose `beginLogin` does not exist.
  const canReauth = false

  /**
   * Pull one provider's row out of a fresh snapshot.
   *
   * A row missing from the snapshot is reported as an error rather than
   * invented: the collector always emits one row per reader, so absence means a
   * real wiring fault and should be visible as one.
   *
   * @returns the provider's quota row.
   */
  const row = async (): Promise<ProviderQuota> => {
    const snapshot = await readSnapshot()
    const found = snapshot.providers.find(provider => provider.id === id)
    return found ?? {
      id,
      name,
      status: 'error',
      windows: [],
      error: `${id} 不在额度快照中（采集器未注册该 provider）`,
      fetchedAt: Date.now(),
    }
  }

  return {
    id,
    async quota() {
      return await row()
    },
    async account() {
      return accountFromQuota(id, name, await row(), LOGIN_PENDING, canLogout, canReauth)
    },
  }
}

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
export function createQuotaBackedAdapters(
  readSnapshot: () => Promise<QuotaSnapshot>,
): AccountAdapter[] {
  return [
    snapshotBackedAdapter('workbuddy', 'WorkBuddy', readSnapshot),
  ]
}
