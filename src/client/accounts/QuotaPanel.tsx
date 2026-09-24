/**
 * The quota panel: what proves a login actually works.
 *
 * A login that reports success is not evidence that the credential *functions*.
 * The only honest proof is a metered read coming back, because that read is
 * authenticated end-to-end with the same credential a model call would use. This
 * panel is therefore not decorative — it is the verification step, and it sits
 * directly under the login control so "did that work?" is answerable without
 * leaving the page.
 *
 * Two rules it keeps:
 *
 * - **Never round a failure into a number.** A provider that could not be read
 *   shows its reason, not `0%`. A full-looking ring on a failed read is worse
 *   than an explicit error, because it is believable.
 * - **Freshness is always visible.** Every read carries when it happened and
 *   whether it is in flight, so a stale number cannot be mistaken for a live one
 *   — which is exactly the ambiguity that makes a login hard to judge.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/accounts/QuotaPanel
 */

import type { ReactNode } from 'react'

import type { ProviderQuota, QuotaWindow } from '../../contract.js'
import css from './QuotaPanel.module.css'

/** Above this consumed share a row turns amber; above the second, red. */
const WARN_AT = 75
const DANGER_AT = 90

/** The severity class of one metered row. */
function levelOf(usedPercent: number | undefined): 'ok' | 'warn' | 'danger' | 'idle' {
  if (usedPercent === undefined) return 'idle'
  if (usedPercent >= DANGER_AT) return 'danger'
  if (usedPercent >= WARN_AT) return 'warn'
  return 'ok'
}

/** "in 51 min" — what a user actually wants from a reset time. */
function relativeReset(resetAt: string | undefined, now: number): string | undefined {
  if (resetAt === undefined) return undefined
  const at = Date.parse(resetAt)
  if (!Number.isFinite(at)) return undefined
  const deltaMs = at - now
  if (deltaMs <= 0) return '即将重置'
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 60) return `${String(minutes)} 分钟后重置`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时后重置`
  return `${String(Math.round(hours / 24))} 天后重置`
}

/** One metered window. */
function WindowRow({ entry, now }: { entry: QuotaWindow; now: number }): ReactNode {
  const used = entry.usedPercent
  const relative = relativeReset(entry.resetAt, now)
  return (
    <div className={css.window}>
      <div className={css.windowHead}>
        <span className={css.windowLabel}>{entry.label}</span>
        <span className={css.windowMeta}>
          {relative ?? entry.detail ?? ''}
        </span>
      </div>
      {used === undefined ? (
        // A balance-only row has no share to meter; its detail line is the value.
        <div className={css.balanceLine}>{entry.detail ?? '—'}</div>
      ) : (
        <>
          <div className={css.bar} data-level={levelOf(used)}>
            <div
              className={css.barFill}
              style={{ width: `${String(Math.min(100, Math.max(0, used)))}%` }}
            />
          </div>
          <div className={css.barCaption}>
            <span>{String(Math.round(used))}% 已用</span>
            {/* The absolute time belongs in the row so a screenshot is unambiguous. */}
            {entry.resetAt !== undefined && (
              <span className={css.absolute}>{new Date(entry.resetAt).toLocaleString()}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Props of the quota panel. */
export interface QuotaPanelProps {
  /** This provider's row from the last snapshot; undefined before the first read. */
  quota: ProviderQuota | undefined
  /** Whether a re-read is in flight. */
  refreshing: boolean
  /** When the snapshot was produced, for the freshness line. */
  snapshotAt?: number | undefined
  /** Force a re-read of every provider. */
  onRefresh(): void
}

/**
 * The quota panel for one provider.
 * @param props - the provider's row plus refresh wiring.
 * @returns the panel element.
 */
export function QuotaPanel(props: QuotaPanelProps): ReactNode {
  const { quota, refreshing, snapshotAt, onRefresh } = props
  // One timestamp for every relative label in this render, so two rows cannot
  // disagree about how long is left.
  const now = Date.now()

  return (
    <section className={css.panel}>
      <div className={css.head}>
        <h3 className={css.title}>额度</h3>
        <span className={css.freshness}>
          {snapshotAt === undefined ? '尚未读取' : `读取于 ${new Date(snapshotAt).toLocaleTimeString()}`}
        </span>
        <button
          type="button"
          className={css.refresh}
          onClick={onRefresh}
          disabled={refreshing}
          title="立即重新读取全部提供商的额度"
        >
          {refreshing ? '刷新中…' : '刷新额度'}
        </button>
      </div>

      {quota === undefined ? (
        <p className={css.empty}>正在读取…</p>
      ) : quota.status === 'ok' ? (
        <>
          {quota.plan !== undefined && <p className={css.plan}>{quota.plan}</p>}
          {quota.account !== undefined && <p className={css.account}>{quota.account}</p>}
          {quota.balance !== undefined && <p className={css.balance}>余额：{quota.balance}</p>}
          {quota.windows.length > 0 ? (
            <div className={css.windows}>
              {quota.windows.map(entry => (
                <WindowRow key={entry.id} entry={entry} now={now} />
              ))}
            </div>
          ) : (
            // `ok` with no windows is a real state (a balance-only provider).
            <p className={css.empty}>该提供商未报告可计量的额度窗口。</p>
          )}
        </>
      ) : (
        // Not `ok`: show why, never a number. An error row here is also the
        // clearest signal that a login did not take effect.
        <div className={css.notice} data-tone={quota.status}>
          <span className={css.noticeTitle}>
            {quota.status === 'unconfigured' ? '未登录 / 未配置' : '读取失败'}
          </span>
          {quota.error !== undefined && <span className={css.noticeDetail}>{quota.error}</span>}
        </div>
      )}
    </section>
  )
}
