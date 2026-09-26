/**
 * dsh-proxy-monitor, browser half.
 *
 * Registers two surfaces and nothing else:
 *
 * 1. **The rail** into `shell.overlay` — the frame's floating layer. That slot
 *    is a `list`, so this entry sits beside whatever else is there rather than
 *    replacing it, and the layer is click-through until an entry opts into
 *    pointer events, so the rail can never block the app underneath. This is
 *    the documented seat for a frame-wide surface and is why the plugin needs
 *    no change to the sidebar, the conversation, or the layout.
 * 2. **A settings section** into `settings.section`, giving the plugin its own
 *    row in the Settings panel.
 *
 * The client never reads a credential: it asks the Host for a snapshot over
 * the plugin-owned Connection RPC channel.
 *
 * @module @dsh-external/dsh-proxy-monitor/client
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'

// Type-only imports: declaration merging for the settings seam's
// `ctx.configForms`, plus the slot contracts this plugin registers into. (The
// slots registry itself and its `ctx.slots` member are declared by the renderer
// package, and this half reaches the registry through the narrow hand-rolled
// context interface below. DSH 0.1.7 removed `@deepseek-ai/dsh-client-runtime`,
// which used to hold both the browser context alias and the settings scope.)
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import { PROXY_MONITOR_ENTRY, type QuotaSnapshot } from '../contract.js'
import { createProxyMonitorTransport, createQuotaBroker, type QuotaBroker } from './api.js'
import { AccountStore } from './accounts/store.js'
import { SectionShell, type ProviderTab } from './accounts/SectionShell.js'
import { useAccounts } from './accounts/useAccounts.js'
import { buildProviderTabs } from './accounts/tabs.js'
import type { AccountActions } from './accounts/AccountBlock.js'
import { QuotaRail, type RailLayout } from './QuotaRail.js'
import { ProxyMonitorSettings, type PluginSettings, type SettingsFace } from './Settings.js'

/**
 * Required browser services.
 *
 * `configForms` is the settings domain's client-side form service: the form for
 * the `dsh-proxy-monitor` entry is what carries this plugin's options, so the
 * rail and the settings section always read and write the same values.
 *
 * There is no `connection` here: this plugin's Host routes are exact POST routes
 * on Connection's shared `/api` channel, reached with a plain same-origin
 * `fetch` (see `api.ts`), so the browser half needs no RPC client.
 */
export const inject = ['slots', 'configForms']

/** The settings section's position in the Settings nav. */
const SETTINGS_ORDER = 40

/** Settings used before the Host's section arrives. Mirrors the Host schema. */
const FALLBACK_SETTINGS: PluginSettings = {
  enabled: true,
  providers: ['deepseek', 'codex', 'workbuddy', 'antigravity', 'grok'],
  anchor: 'right',
  align: 'center',
  restingOpacity: 82,
  showPercent: true,
  expandOnHover: true,
  refreshSeconds: 60,
  sortAlphabetically: false,
  yieldToTurnNav: true,
}

/** The slice of the settings form service this plugin binds. */
interface ConfigFormLike<T> {
  getSnapshot(): { value: T | undefined }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

/** The subset of the client context this plugin reads. */
interface PluginContext {
  configForms: {
    get<T>(entryId: string): ConfigFormLike<T>
  }
  slots: {
    inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  effect(callback: () => (() => void) | void, label?: string): () => void
}

/**
 * A live subscription to the plugin settings held in the Host document.
 *
 * Modelled as a tiny observable rather than reaching for a state library: the
 * store is one object, two surfaces read it, and the slot framework's own
 * contract is a `getSnapshot`/`subscribe` pair.
 */
class SettingsStore {
  private value: PluginSettings = FALLBACK_SETTINGS
  private readonly listeners = new Set<() => void>()

  /** The current settings; identity is stable until a write commits. */
  getSnapshot(): PluginSettings {
    return this.value
  }

  /** Observe commits. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Adopt a value read from the Host scope. */
  adopt(next: PluginSettings | undefined): void {
    if (next === undefined) return
    this.value = next
    for (const listener of this.listeners) listener()
  }
}

/** Subscribe a component to the settings store. */
function useSettings(store: SettingsStore): PluginSettings {
  const [value, setValue] = useState<PluginSettings>(() => store.getSnapshot())
  useEffect(() => {
    setValue(store.getSnapshot())
    return store.subscribe(() => {
      setValue(store.getSnapshot())
    })
  }, [store])
  return value
}

/**
 * The rail: owns the polling loop and hands the rail its data.
 *
 * Polling lives in the browser half rather than on the Host so an idle browser
 * stops asking, and the interval is the one the user chose; the Host caches for
 * the same window, so the two cannot multiply requests.
 * @param props - live settings, the snapshot broker, and the shared account state.
 * @returns the rail, or null while it has nothing to show.
 */
function RailHost({ settings, broker, accounts }: {
  settings: PluginSettings
  broker: QuotaBroker
  accounts: AccountStore
}): ReactNode {
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [transportError, setTransportError] = useState<string | undefined>(undefined)
  // Bumped by the refresh button; a dependency of the polling effect so a
  // manual refresh also restarts the cadence.
  const [nonce, setNonce] = useState(0)

  // The same store the settings page reads, so a login started in either place
  // is reflected in both without a reload.
  const accountState = useAccounts(accounts)

  useEffect(() => {
    let live = true
    const load = async (force: boolean): Promise<void> => {
      if (!live) return
      setBusy(true)
      try {
        const next = force ? (await broker.refresh()).snapshot : await broker.snapshot()
        if (!live) return
        setSnapshot(next)
        setTransportError(undefined)
      } catch (error) {
        if (!live) return
        setTransportError(error instanceof Error ? error.message : String(error))
      } finally {
        if (live) setBusy(false)
      }
    }

    void load(nonce > 0)
    const periodMs = Math.max(15, settings.refreshSeconds) * 1000
    const timer = window.setInterval(() => {
      // A hidden tab must not keep polling: the user cannot see the rail, and
      // usage endpoints are rate-limited by several vendors.
      if (document.visibilityState === 'visible') void load(false)
    }, periodMs)

    // Returning to a hidden tab should show fresh numbers immediately.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load(false)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      live = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [broker, settings.refreshSeconds, nonce])

  const layout: RailLayout = {
    anchor: settings.anchor,
    align: settings.align,
    restingOpacity: settings.restingOpacity,
    showPercent: settings.showPercent,
    expandOnHover: settings.expandOnHover,
    sortAlphabetically: settings.sortAlphabetically,
  }

  const accountActions: AccountActions = {
    onLogin: id => {
      void accounts.login(id)
    },
    onLogout: id => {
      void accounts.logout(id)
    },
    busyId: accountState.busyId,
    ticket: accountState.ticket,
  }

  if (!settings.enabled) return null
  const providers = snapshot?.providers.filter(provider => settings.providers.includes(provider.id)) ?? []
  // Nothing to show: stay invisible rather than render an empty slab.
  if (providers.length === 0) return null

  return (
    <QuotaRail
      providers={providers}
      order={settings.providers}
      layout={layout}
      busy={busy}
      transportError={transportError}
      yieldToTurnNav={settings.yieldToTurnNav}
      accounts={accountState.accounts}
      accountActions={accountActions}
      onRefresh={() => {
        setNonce(current => current + 1)
      }}
    />
  )
}

/**
 * The unified reverse-proxy settings section.
 *
 * Reads the same {@link AccountStore} the rail uses, so the two surfaces never
 * disagree about login state, and renders the shared shell with one tab per
 * provider. It also owns the quota read that verifies a login: the numbers come
 * from the same snapshot the rail meters, so a successful login shows up in both
 * places at once rather than only where the user happens to be looking.
 *
 * @param props - the shared account store plus the snapshot broker.
 * @returns the section element.
 */
function ProxyAccountsSection({ accounts, broker }: {
  accounts: AccountStore
  broker: QuotaBroker
}): ReactNode {
  const state = useAccounts(accounts)
  const tabs: readonly ProviderTab[] = buildProviderTabs(state.accounts)

  // The section reads quota through the same broker the rail uses. It fetches on
  // mount so opening the page shows current numbers rather than nothing, and
  // re-fetches on demand from the panel's refresh control.
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | undefined>(undefined)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (force: boolean): Promise<void> => {
    setRefreshing(true)
    try {
      const next = force ? (await broker.refresh()).snapshot : await broker.snapshot()
      setSnapshot(next)
    } catch {
      // The account store already surfaces transport failures; the quota panel
      // simply keeps its previous numbers rather than blanking.
    } finally {
      setRefreshing(false)
    }
  }, [broker])

  useEffect(() => {
    void load(false)
  }, [load])

  return (
    <SectionShell
      tabs={tabs}
      accounts={state.accounts}
      quotas={snapshot?.providers ?? []}
      loading={state.loading}
      refreshing={refreshing}
      snapshotAt={snapshot?.fetchedAt}
      transportError={state.error}
      onLogin={id => {
        void accounts.login(id)
      }}
      onLogout={id => {
        void accounts.logout(id)
      }}
      onRefreshQuota={() => {
        void load(true)
      }}
      busyId={state.busyId}
      ticket={state.ticket}
    />
  )
}

/**
 * Browser plugin body.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const context = ctx as unknown as PluginContext
  const broker = createQuotaBroker(createProxyMonitorTransport())
  // One form for the whole plugin, keyed by the Host entry id: the seam
  // projects exactly that entry's volatile Config fields, so the settings
  // section below writes the same object this half reads for the rail.
  const form = context.configForms.get<PluginSettings>(PROXY_MONITOR_ENTRY)
  const store = new SettingsStore()
  store.adopt(form.getSnapshot().value)

  // Settings live in the Host document, so this half must follow writes made
  // anywhere — the settings page here, or another window.
  ctx.effect(() => {
    const sync = (): void => {
      store.adopt(form.getSnapshot().value)
    }
    sync()
    return form.subscribe(sync)
  }, 'dsh-proxy-monitor: settings subscription')

  // One surface owns the fetch; the other reads its result instead of opening a
  // second polling loop. The face is built per render from these two refs.
  const shared: { snapshot: QuotaSnapshot | undefined } = { snapshot: undefined }

  // One account store for the whole plugin: the rail and the settings page both
  // subscribe to it, so a login started in one is visible in the other.
  const accounts = new AccountStore(broker)
  ctx.effect(() => () => {
    accounts.dispose()
  }, 'dsh-proxy-monitor: account store')

  ctx.effect(
    () =>
      context.slots.inject('shell.overlay', () =>
        context.slots.register(
          { name: 'shell.overlay', id: 'dsh-proxy-monitor', order: 40 },
          function ProxyMonitorOverlay(): ReactNode {
            const settings = useSettings(store)
            return <RailHost settings={settings} broker={broker} accounts={accounts} />
          },
        ),
      ),
    'dsh-proxy-monitor: overlay registration',
  )

  ctx.effect(
    () =>
      context.slots.inject('settings.section', () =>
        context.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-proxy-monitor',
            order: SETTINGS_ORDER,
            label: () => '额度监控',
            // The face carries stable references only: the component reads live
            // values itself, so a factory called once at registration cannot
            // freeze a stale snapshot into the UI.
            inject: (): SettingsFace => ({
              store,
              broker,
              shared,
              write: (field, value) => {
                void form.set(field, value)
              },
            }),
          },
          ProxyMonitorSettings as unknown as (props: never) => ReactNode,
        ),
      ),
    'dsh-proxy-monitor: settings section',
  )

  ctx.effect(
    () =>
      context.slots.inject('settings.section', () =>
        context.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-proxy-monitor-accounts',
            order: SETTINGS_ORDER + 1,
            label: () => '订阅反代',
          },
          function ProxyAccountsSlot(): ReactNode {
            return <ProxyAccountsSection accounts={accounts} broker={broker} />
          },
        ),
      ),
    'dsh-proxy-monitor: accounts section',
  )
}
