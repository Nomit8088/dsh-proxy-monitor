/**
 * The settings shell: one nav entry whose body switches between providers.
 *
 * This is the "one entry, internal tabs" decision. The alternative — one
 * `settings.section` per provider — would put four or five rows in the Settings
 * nav, each a differently-styled page from a different upstream project. The
 * shell instead owns the nav row, the provider switch, and the shared account
 * block, and each provider contributes only its own *specific* fields as tab
 * content.
 *
 * The split matters because it puts every provider difference in one place
 * (a tab's children) and every provider similarity in another (this file plus
 * {@link AccountBlock}), so a new provider adds a tab without restyling a page.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/accounts/SectionShell
 */

import { useState, type ReactNode } from 'react'

import type { AccountActions } from './AccountBlock.js'
import { AccountBlock } from './AccountBlock.js'
import { QuotaPanel } from './QuotaPanel.js'
import type { ProviderAccount, ProxiedProviderId } from '../../accounts/contract.js'
import type { ProviderQuota } from '../../contract.js'
import css from './SectionShell.module.css'

/**
 * One tab: a provider's account block plus whatever fields are specific to it.
 *
 * `render` is a thunk rather than an element so the body is rebuilt per render
 * from live state: a tab whose content captured a snapshot at construction
 * would show stale values after the first refresh.
 */
export interface ProviderTab {
  id: ProxiedProviderId
  /** Tab label; the provider's display name. */
  label: string
  /**
   * Render this provider's specific fields.
   * @param account - the live account row, so a tab can tailor its copy to the state.
   * @returns the tab body below the shared account block.
   */
  render(account: ProviderAccount | undefined): ReactNode
}

/** Props of the settings shell. */
export interface SectionShellProps extends AccountActions {
  /** One tab per reverse-proxied provider, in display order. */
  tabs: readonly ProviderTab[]
  /** Live account rows, keyed by provider id. */
  accounts: readonly ProviderAccount[]
  /** Live quota rows, keyed by provider id — what proves a login actually works. */
  quotas: readonly ProviderQuota[]
  /** Whether the account list itself is still loading. */
  loading: boolean
  /** Whether a quota re-read is in flight. */
  refreshing: boolean
  /** A transport-level failure, distinct from one provider's own error. */
  transportError?: string | undefined
  /** When the whole quota snapshot was produced, for the freshness line. */
  snapshotAt?: number | undefined
  /** Force a re-read of every provider's quota. */
  onRefreshQuota(): void
}

/**
 * The settings shell.
 * @param props - tabs, live accounts and quotas, and the shared actions.
 * @returns the shell element.
 */
export function SectionShell(props: SectionShellProps): ReactNode {
  const {
    tabs, accounts, quotas, loading, refreshing, transportError, snapshotAt,
    onRefreshQuota, ...actions
  } = props
  const [activeId, setActiveId] = useState<ProxiedProviderId | undefined>(tabs[0]?.id)

  const byId = new Map(accounts.map(account => [account.id, account]))
  const quotaById = new Map(quotas.map(quota => [quota.id, quota]))
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]

  return (
    <div className={css.shell}>
      <header className={css.header}>
        <h2 className={css.heading}>订阅反代</h2>
        <p className={css.lead}>
          把各家的订阅账号接入 DSH，并在侧栏圆环中显示额度消耗。登录状态与额度读取共用同一份凭证。
        </p>
      </header>

      {transportError !== undefined && (
        <div className={css.transportError}>状态读取失败：{transportError}</div>
      )}

      <nav className={css.tabs} role="tablist" aria-label="提供商">
        {tabs.map(tab => {
          const account = byId.get(tab.id)
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={css.tab}
              data-active={tab.id === active?.id ? 'true' : undefined}
              data-state={account?.state ?? 'unknown'}
              aria-selected={tab.id === active?.id}
              onClick={() => { setActiveId(tab.id) }}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      {active === undefined ? (
        <p className={css.empty}>此构建未包含任何反代提供商。</p>
      ) : (
        <section className={css.body} role="tabpanel" aria-label={active.label}>
          {loading && byId.get(active.id) === undefined ? (
            <p className={css.empty}>正在读取登录状态…</p>
          ) : (
            <AccountBlock
              account={byId.get(active.id) ?? {
                id: active.id,
                name: active.label,
                state: 'error',
                login: { kind: 'none', reason: 'account unavailable' },
                canLogout: false,
                canReauth: false,
                error: 'account row missing from the last read',
              }}
              {...actions}
            />
          )}
          {active.render(byId.get(active.id))}
          {/*
            The quota panel is what turns a login into a verifiable fact. Without
            it a user who just signed in has no way to tell whether it worked
            short of switching models and hoping; the numbers either arrive or
            they do not, and the refresh button re-asks on demand.
          */}
          <QuotaPanel
            quota={quotaById.get(active.id)}
            refreshing={refreshing}
            snapshotAt={snapshotAt}
            onRefresh={onRefreshQuota}
          />
        </section>
      )}
    </div>
  )
}
