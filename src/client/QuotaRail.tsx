/**
 * The quota rail: a floating column of ring gauges, one per provider.
 *
 * Visual model (from the reference design): a dark rounded slab pinned to the
 * viewport edge, each provider a circled icon whose circumference is filled by
 * the consumed share. Hovering or clicking a ring expands a detail card beside
 * it showing every metered window with its reset time.
 *
 * Two constraints shape the implementation:
 *
 * - **It must not fight the app's theme.** Every surface is drawn from the
 *   `--dsw-*` alias tokens, so the rail follows light/dark/system for free
 *   rather than carrying its own palette.
 * - **It must not block the app.** The rail lives in the frame's overlay layer
 *   (which is click-through by default) and opts back into pointer events only
 *   on its own elements; it is also faded at rest and lifts on hover or focus.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/QuotaRail
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { ProviderQuota, QuotaWindow } from '../contract.js'
import type { ProviderAccount, ProxiedProviderId } from '../accounts/contract.js'
import { AccountBlock, type AccountActions } from './accounts/AccountBlock.js'
import { useFrameInsets } from './frame.js'
import { providerMark } from './icons.js'
import { useTurnNavigatorClearance } from './turnnav.js'
import css from './QuotaRail.module.css'

/** Ring geometry: a 44px box with a 2px stroke inset by 3px. */
const RING_SIZE = 44
const RING_STROKE = 2.5
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2 - 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** Above this consumed share the ring turns amber; above the second, red. */
const WARN_AT = 75
const DANGER_AT = 90

/** How the rail is laid out; mirrors the host settings schema. */
export interface RailLayout {
  anchor: 'right' | 'left'
  align: 'center' | 'top' | 'bottom'
  restingOpacity: number
  showPercent: boolean
  expandOnHover: boolean
  sortAlphabetically: boolean
}

/** Props of the rail. */
export interface QuotaRailProps {
  providers: readonly ProviderQuota[]
  /** Order the host settings ask for; the rail applies it. */
  order: readonly string[]
  layout: RailLayout
  /** Whether a refresh is in flight. */
  busy: boolean
  /** Last refresh failure, when the transport itself failed. */
  transportError?: string | undefined
  /** Whether the rail may nudge DSH's own turn navigator aside. */
  yieldToTurnNav: boolean
  onRefresh: () => void
  /**
   * Live account rows for the reverse-proxied providers.
   *
   * The card shows a provider's account block only when its quota row maps to a
   * proxied provider *and* an account row exists: DeepSeek and Claude are
   * quota-only rows with no session this plugin owns, so they correctly get no
   * login UI.
   */
  accounts: readonly ProviderAccount[]
  /** Login/logout actions, shared with the settings page's store. */
  accountActions: AccountActions
}

/**
 * The providers whose session this plugin can manage.
 *
 * Duplicated as a literal rather than imported from the host contract because
 * the browser half must not depend on a host-side module; the two are tied
 * together by {@link ProviderAccount}'s id union, which fails the build if they
 * ever diverge.
 */
const PROXIED_IDS: readonly string[] = ['codex', 'antigravity', 'workbuddy', 'grok']

/** The provider id to treat as proxied, or undefined when it is quota-only. */
function proxiedId(id: string): ProxiedProviderId | undefined {
  return PROXIED_IDS.includes(id) ? (id as ProxiedProviderId) : undefined
}

/** The state class of a ring, from its consumed share. */
function levelOf(usedPercent: number | undefined): 'ok' | 'warn' | 'danger' | 'idle' {
  if (usedPercent === undefined) return 'idle'
  if (usedPercent >= DANGER_AT) return 'danger'
  if (usedPercent >= WARN_AT) return 'warn'
  return 'ok'
}

/** "73%" — the rail never shows a fraction of a percent. */
function percentLabel(usedPercent: number | undefined): string {
  return usedPercent === undefined ? '—' : `${String(Math.round(usedPercent))}%`
}

/**
 * A relative reset description ("in 51 min"), which is what a user actually
 * wants from a reset time; the absolute time goes in the row's title.
 * @param resetAt - ISO reset timestamp.
 * @param now - current epoch ms, passed in so every row in a render agrees.
 * @returns the relative label, or undefined when unparseable.
 */
function relativeReset(resetAt: string | undefined, now: number): string | undefined {
  if (resetAt === undefined) return undefined
  const at = Date.parse(resetAt)
  if (!Number.isFinite(at)) return undefined
  const deltaMs = at - now
  if (deltaMs <= 0) return 'resetting'
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 60) return `in ${String(minutes)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${String(hours)} h`
  return `in ${String(Math.round(hours / 24))} d`
}

/** "Thu 12:00 AM" — the absolute reset label for a row's title. */
function absoluteReset(resetAt: string | undefined): string | undefined {
  if (resetAt === undefined) return undefined
  const at = Date.parse(resetAt)
  if (!Number.isFinite(at)) return undefined
  return new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** One ring: the progress arc plus the provider mark. */
function Ring({ provider }: { provider: ProviderQuota }): ReactNode {
  const used = provider.usedPercent
  const ratio = used === undefined ? 0 : Math.min(100, Math.max(0, used)) / 100
  const level = levelOf(used)
  const dash = RING_CIRCUMFERENCE * ratio

  return (
    <svg
      className={css.ring}
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`}
      data-level={level}
      aria-hidden="true"
    >
      {/* The track: a full circle in the neutral border token. */}
      <circle
        className={css.ringTrack}
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
      />
      {/* The arc starts at 12 o'clock and grows clockwise. */}
      <circle
        className={css.ringArc}
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${String(dash)} ${String(RING_CIRCUMFERENCE - dash)}`}
        transform={`rotate(-90 ${String(RING_SIZE / 2)} ${String(RING_SIZE / 2)})`}
      />
    </svg>
  )
}

/** One window row inside a detail card. */
function WindowRow({ window: entry, now }: { window: QuotaWindow; now: number }): ReactNode {
  const relative = relativeReset(entry.resetAt, now)
  const absolute = absoluteReset(entry.resetAt)
  const title = absolute === undefined ? undefined : `Resets ${absolute}`
  const used = entry.usedPercent

  return (
    <div className={css.window} title={title}>
      <div className={css.windowHead}>
        <span className={css.windowLabel}>{entry.label}</span>
        <span className={css.windowReset}>{relative ?? entry.detail ?? ''}</span>
      </div>
      {used === undefined ? (
        // A balance row has no share to meter; its detail line is the value.
        <div className={css.balanceLine}>{entry.detail ?? '—'}</div>
      ) : (
        <>
          <div className={css.bar} data-level={levelOf(used)}>
            <div className={css.barFill} style={{ width: `${String(Math.min(100, Math.max(0, used)))}%` }} />
          </div>
          <div className={css.barCaption}>{percentLabel(used)} used</div>
        </>
      )}
    </div>
  )
}

/** The expanded card for one provider. */
function DetailCard({
  provider,
  now,
  account,
  accountActions,
}: {
  provider: ProviderQuota
  now: number
  account: ProviderAccount | undefined
  accountActions: AccountActions
}): ReactNode {
  return (
    <div className={css.card} role="dialog" aria-label={`${provider.name} usage`}>
      <div className={css.cardHead}>
        <span className={css.cardIcon} data-level={levelOf(provider.usedPercent)}>
          {providerMark(provider.id, 18)}
        </span>
        <div className={css.cardTitles}>
          <span className={css.cardName}>{provider.name}</span>
          {provider.plan !== undefined && <span className={css.cardPlan}>{provider.plan}</span>}
        </div>
      </div>

      {provider.status === 'ok' && provider.windows.length > 0 && (
        <div className={css.windows}>
          {provider.windows.map(entry => (
            <WindowRow key={entry.id} window={entry} now={now} />
          ))}
        </div>
      )}

      {provider.status !== 'ok' && (
        <div className={css.cardNotice} data-tone={provider.status}>
          {provider.error ?? 'No data'}
        </div>
      )}

      {/*
        The account block is the unified login surface: the same component the
        settings page renders, so signing in from either place looks and behaves
        identically. It appears only for providers whose session this plugin
        owns — a balance-only row has nothing to sign in to.
      */}
      {account !== undefined && (
        <div className={css.cardAccount}>
          <AccountBlock account={account} {...accountActions} />
        </div>
      )}

      {(provider.account !== undefined || provider.balance !== undefined) && (
        <div className={css.cardFoot}>
          {provider.account !== undefined && <span className={css.cardAccountName}>{provider.account}</span>}
          {provider.balance !== undefined && <span className={css.cardBalance}>{provider.balance}</span>}
        </div>
      )}
    </div>
  )
}

/**
 * The floating rail.
 * @param props - providers, layout, and refresh wiring.
 * @returns the rail element.
 */
export function QuotaRail(props: QuotaRailProps): ReactNode {
  const { providers, order, layout, busy, transportError, yieldToTurnNav, onRefresh, accounts, accountActions } = props
  const [openId, setOpenId] = useState<string | undefined>(undefined)
  const [hoverId, setHoverId] = useState<string | undefined>(undefined)
  const [engaged, setEngaged] = useState(false)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [slab, setSlab] = useState<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const slabRef = useRef<HTMLDivElement | null>(null)

  // The rail element is published to state once, after mount: a ref callback
  // whose identity changed per render would detach and reattach on every pass.
  useEffect(() => {
    setHost(rootRef.current)
    setSlab(slabRef.current)
  }, [])

  // The overlay layer spans the whole frame, including the columns the left and
  // right sidebars occupy. Reading the frame's live geometry keeps the rail
  // beside those panels instead of on top of them.
  const insets = useFrameInsets(host, true)

  // DSH's turn navigator is pinned to the same edge the rail hugs, so it is
  // pushed just clear of the slab. Keyed on the insets because the navigator
  // moves with the chat column while the rail moves with the frame: the two can
  // change relationship without either box resizing.
  useTurnNavigatorClearance(
    slab,
    true,
    yieldToTurnNav,
    layout.anchor,
    `${String(insets.sidebar)}:${String(insets.rightbar)}`,
  )

  // Relative reset labels must not freeze at mount, but re-rendering the whole
  // rail every second would be wasteful; one tick a minute is plenty.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 60_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  // Escape closes an expanded card; the rail is keyboard reachable so this is
  // the expected dismissal for a user who tabbed into it.
  useEffect(() => {
    if (openId === undefined && hoverId === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpenId(undefined)
      setHoverId(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [openId, hoverId])

  // A pointer anywhere outside the rail closes a click-opened card.
  useEffect(() => {
    if (openId === undefined) return
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return
      setOpenId(undefined)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [openId])

  const ordered = useMemo(() => {
    if (layout.sortAlphabetically) {
      return [...providers].sort((left, right) => left.name.localeCompare(right.name))
    }
    // Providers the host did not report are dropped rather than appended: the
    // settings order is the display contract.
    const rank = new Map(order.map((id, index) => [id, index]))
    return [...providers].sort((left, right) => (rank.get(left.id) ?? 99) - (rank.get(right.id) ?? 99))
  }, [providers, order, layout.sortAlphabetically])

  const expandedId = layout.expandOnHover ? (hoverId ?? openId) : openId

  /** Account rows keyed by provider, so the card's lookup is O(1) per render. */
  const accountById = useMemo(
    () => new Map(accounts.map(account => [account.id, account])),
    [accounts],
  )

  const toggle = useCallback((id: string) => {
    setOpenId(current => (current === id ? undefined : id))
  }, [])

  const style = useMemo(
    () =>
      ({
        '--dsh-pm-rest-opacity': String(layout.restingOpacity / 100),
        '--dsh-pm-inset-left': `${String(insets.sidebar)}px`,
        '--dsh-pm-inset-right': `${String(insets.rightbar)}px`,
      }) as React.CSSProperties,
    [layout.restingOpacity, insets.sidebar, insets.rightbar],
  )

  // A fullscreen right panel owns the viewport (a document reader, a terminal).
  // The rail steps aside rather than floating over content the user opened on
  // purpose; it returns the moment the panel is dismissed.
  if (insets.rightbarFullscreen) return null
  return (
    <div
      ref={rootRef}
      className={css.rail}
      style={style}
      data-anchor={layout.anchor}
      data-align={layout.align}
      data-engaged={engaged || expandedId !== undefined ? 'true' : undefined}
      onPointerEnter={() => {
        setEngaged(true)
      }}
      onPointerLeave={() => {
        setEngaged(false)
        setHoverId(undefined)
      }}
      onFocusCapture={() => {
        setEngaged(true)
      }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setEngaged(false)
      }}
    >
      <div className={css.slab} ref={slabRef}>
        {/* The painted tab shape: fill, inner rounding, and the concave fillets
            that fade it into the screen edge. Kept as its own layer because it
            owns the drop-shadow filter, which would otherwise capture the
            expanded cards (a filter applies to a whole subtree). */}
        <div className={css.slabShape} aria-hidden="true" />
        {ordered.map(provider => {
          const expanded = expandedId === provider.id
          const level = levelOf(provider.usedPercent)
          return (
            <div
              key={provider.id}
              className={css.slot}
              data-level={level}
              onPointerEnter={() => {
                if (layout.expandOnHover) setHoverId(provider.id)
              }}
            >
              <button
                type="button"
                className={css.trigger}
                aria-expanded={expanded}
                aria-label={`${provider.name} usage, ${percentLabel(provider.usedPercent)} used`}
                onClick={() => {
                  toggle(provider.id)
                }}
              >
                <span className={css.ringWrap}>
                  <Ring provider={provider} />
                  <span className={css.ringGlyph}>{providerMark(provider.id, 18)}</span>
                </span>
                {layout.showPercent && <span className={css.percent}>{percentLabel(provider.usedPercent)}</span>}
              </button>

              {expanded && (
                <div className={css.popover} data-anchor={layout.anchor}>
                  {/* The bridge from the card to the slab. Rendered behind the
                      card so its inner end is covered by the card's own fill. */}
                  <div className={css.tongue} aria-hidden="true" />
                  <DetailCard
                    provider={provider}
                    now={now}
                    account={(() => {
                      const proxied = proxiedId(provider.id)
                      return proxied === undefined ? undefined : accountById.get(proxied)
                    })()}
                    accountActions={accountActions}
                  />
                </div>
              )}
            </div>
          )
        })}

        <div className={css.actions}>
          <button
            type="button"
            className={css.action}
            onClick={onRefresh}
            disabled={busy}
            aria-label="Refresh usage"
            title={transportError ?? 'Refresh usage'}
            data-error={transportError === undefined ? undefined : 'true'}
          >
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.3 5.7" strokeLinecap="round" />
              <path d="M20 4.5V11h-6.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
