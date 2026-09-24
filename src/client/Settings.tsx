/**
 * The plugin's settings section.
 *
 * This is a first-class section in the Settings panel (its own left-nav row),
 * not a General-page row: the plugin has enough options — provider roster,
 * placement, opacity, polling — that a single row would bury them.
 *
 * Writes go through the settings scope the Host registered, so the section
 * under `dsh-proxy-monitor:` in `settings.yaml` is the single source of truth
 * and the rail follows a change immediately (the Host watches the same
 * namespace and re-points the collector live).
 *
 * @module @dsh-external/dsh-proxy-monitor/client/Settings
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { ProviderQuota, QuotaSnapshot } from '../contract.js'
import type { QuotaBroker } from './api.js'
import { providerMark } from './icons.js'
import css from './Settings.module.css'

/** The settings value shape, mirroring the Host schema. */
export interface PluginSettings {
  enabled: boolean
  providers: string[]
  anchor: 'right' | 'left'
  align: 'center' | 'top' | 'bottom'
  restingOpacity: number
  showPercent: boolean
  expandOnHover: boolean
  refreshSeconds: number
  sortAlphabetically: boolean
  yieldToTurnNav: boolean
}

/** A live observable settings source. */
export interface SettingsSource {
  getSnapshot(): PluginSettings
  subscribe(listener: () => void): () => void
}

/** The face injected into the section; references only, never values. */
export interface SettingsFace {
  store: SettingsSource
  broker: QuotaBroker
  /** Snapshot shared with the rail, so the roster agrees with the side rail. */
  shared: { snapshot: QuotaSnapshot | undefined }
  write(field: keyof PluginSettings, value: unknown): void
}

/** Props the slot framework composes for this section. */
export type SettingsSectionProps = SettingsFace & { close?: () => void }

/** Display metadata for providers this plugin can show. */
const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  codex: 'Codex',
  workbuddy: 'WorkBuddy',
  antigravity: 'Antigravity',
  grok: 'Grok',
  claude: 'Claude',
}

/** Every provider id this plugin knows, in default display order. */
const KNOWN_PROVIDERS: readonly string[] = Object.keys(PROVIDER_LABELS)

/** One-line status for a provider row. */
function summarize(provider: ProviderQuota | undefined): string {
  if (provider === undefined) return '尚未读取'
  if (provider.status === 'unconfigured') return provider.error ?? '未配置'
  if (provider.status === 'error') return provider.error ?? '读取失败'
  if (provider.usedPercent !== undefined) return `${String(Math.round(provider.usedPercent))}% 已用`
  return provider.balance === undefined ? '已连接' : `余额 ${provider.balance}`
}

/** A labelled switch row. */
function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}): ReactNode {
  return (
    <label className={css.row}>
      <span className={css.rowText}>
        <span className={css.rowTitle}>{title}</span>
        <span className={css.rowDesc}>{description}</span>
      </span>
      <input
        type="checkbox"
        className={css.switch}
        checked={checked}
        onChange={event => {
          onChange(event.target.checked)
        }}
      />
    </label>
  )
}

/** A segmented choice row. */
function ChoiceRow<T extends string>({
  title,
  description,
  value,
  choices,
  onChange,
}: {
  title: string
  description: string
  value: T
  choices: readonly { value: T; label: string }[]
  onChange: (next: T) => void
}): ReactNode {
  return (
    <div className={css.row}>
      <span className={css.rowText}>
        <span className={css.rowTitle}>{title}</span>
        <span className={css.rowDesc}>{description}</span>
      </span>
      <span className={css.segmented}>
        {choices.map(choice => (
          <button
            key={choice.value}
            type="button"
            className={css.segment}
            data-active={choice.value === value ? 'true' : undefined}
            onClick={() => {
              onChange(choice.value)
            }}
          >
            {choice.label}
          </button>
        ))}
      </span>
    </div>
  )
}

/** A numeric row backed by a range plus its current value. */
function SliderRow({
  title,
  description,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  title: string
  description: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (next: number) => void
}): ReactNode {
  return (
    <label className={css.row}>
      <span className={css.rowText}>
        <span className={css.rowTitle}>{title}</span>
        <span className={css.rowDesc}>{description}</span>
      </span>
      <span className={css.sliderWrap}>
        <input
          type="range"
          className={css.slider}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={event => {
            onChange(Number(event.target.value))
          }}
        />
        <span className={css.sliderValue}>
          {value}
          {suffix ?? ''}
        </span>
      </span>
    </label>
  )
}

/**
 * The settings section.
 *
 * It reads settings through the store's subscription rather than through its
 * injected props, because the slot framework calls `inject` once per
 * registration: a value captured there would be frozen at mount and the page
 * would never show a reopened value.
 *
 * @param props - the injected face.
 * @returns the section element.
 */
export function ProxyMonitorSettings(props: SettingsSectionProps): ReactNode {
  const { store, broker, shared, write } = props

  const [settings, setSettings] = useState<PluginSettings>(() => store.getSnapshot())
  useEffect(() => {
    setSettings(store.getSnapshot())
    return store.subscribe(() => {
      setSettings(store.getSnapshot())
    })
  }, [store])

  // The roster needs live statuses. Reusing the rail's snapshot when it is
  // present avoids a second upstream read; otherwise this asks once so the
  // page is useful even with the rail disabled.
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | undefined>(() => shared.snapshot)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    if (shared.snapshot !== undefined) {
      setSnapshot(shared.snapshot)
      return
    }
    setBusy(true)
    void broker
      .snapshot()
      .then(next => {
        if (!live) return
        shared.snapshot = next
        setSnapshot(next)
      })
      .catch(() => {
        // The rail reports transport failures; the roster only stays stale.
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    return () => {
      live = false
    }
  }, [broker, shared])

  const refresh = (): void => {
    setBusy(true)
    void broker
      .refresh()
      .then(result => {
        shared.snapshot = result.snapshot
        setSnapshot(result.snapshot)
      })
      .catch(() => {})
      .finally(() => {
        setBusy(false)
      })
  }

  // Keyed by plain string: the roster is driven by the settings document, whose
  // provider ids are strings rather than the branded ProviderId union.
  const byId = useMemo(
    () => new Map<string, ProviderQuota>((snapshot?.providers ?? []).map(provider => [provider.id, provider])),
    [snapshot],
  )

  const selected = useMemo(() => new Set(settings.providers), [settings.providers])
  const chosen = useMemo(
    () => settings.providers.filter(id => KNOWN_PROVIDERS.includes(id)),
    [settings.providers],
  )
  const rest = useMemo(() => KNOWN_PROVIDERS.filter(id => !selected.has(id)), [selected])

  const toggleProvider = (id: string): void => {
    const next = selected.has(id)
      ? settings.providers.filter(entry => entry !== id)
      : [...settings.providers, id]
    write('providers', next)
  }

  const move = (id: string, delta: number): void => {
    const list = [...settings.providers]
    const from = list.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= list.length) return
    const [moved] = list.splice(from, 1)
    if (moved === undefined) return
    list.splice(to, 0, moved)
    write('providers', list)
  }

  /** One roster row, shared by the selected and unselected halves. */
  const renderRow = (id: string, index: number, total: number): ReactNode => {
    const provider = byId.get(id)
    const on = selected.has(id)
    return (
      <li key={id} className={css.providerRow} data-on={on ? 'true' : 'false'}>
        <input
          type="checkbox"
          className={css.checkbox}
          checked={on}
          onChange={() => {
            toggleProvider(id)
          }}
        />
        <span className={css.providerMark} data-available={provider?.status === 'ok' ? 'true' : undefined}>
          {providerMark(id, 16)}
        </span>
        <span className={css.providerText}>
          <span className={css.providerName}>{PROVIDER_LABELS[id] ?? id}</span>
          <span className={css.providerSummary}>{summarize(provider)}</span>
        </span>
        <span className={css.orderButtons}>
          {on && (
            <>
              <button
                type="button"
                className={css.orderButton}
                disabled={index === 0}
                aria-label={`上移 ${PROVIDER_LABELS[id] ?? id}`}
                onClick={() => {
                  move(id, -1)
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className={css.orderButton}
                disabled={index === total - 1}
                aria-label={`下移 ${PROVIDER_LABELS[id] ?? id}`}
                onClick={() => {
                  move(id, 1)
                }}
              >
                ↓
              </button>
            </>
          )}
        </span>
      </li>
    )
  }

  return (
    <div className={css.section}>
      <header className={css.header}>
        <h2 className={css.heading}>额度监控</h2>
        <p className={css.lead}>
          在界面边缘显示一个悬浮的圆环侧栏，实时展示各提供商的额度消耗。悬停或点击圆环可展开详情卡片。
        </p>
      </header>

      <section className={css.group}>
        <h3 className={css.groupTitle}>显示</h3>
        <ToggleRow
          title="启用侧栏"
          description="关闭后侧栏隐藏，设置与数据读取保持不变"
          checked={settings.enabled}
          onChange={next => {
            write('enabled', next)
          }}
        />
        <ToggleRow
          title="显示百分比数字"
          description="在圆环下方显示消耗百分比"
          checked={settings.showPercent}
          onChange={next => {
            write('showPercent', next)
          }}
        />
        <ToggleRow
          title="悬停即展开"
          description="关闭后需点击圆环才展开详情卡"
          checked={settings.expandOnHover}
          onChange={next => {
            write('expandOnHover', next)
          }}
        />
        <ToggleRow
          title="按名称排序"
          description="关闭则按下方提供商的排列顺序显示"
          checked={settings.sortAlphabetically}
          onChange={next => {
            write('sortAlphabetically', next)
          }}
        />
      </section>

      <section className={css.group}>
        <h3 className={css.groupTitle}>位置与外观</h3>
        <ChoiceRow
          title="贴靠边缘"
          description="侧栏停靠在哪一侧"
          value={settings.anchor}
          choices={[
            { value: 'right', label: '右侧' },
            { value: 'left', label: '左侧' },
          ]}
          onChange={next => {
            write('anchor', next)
          }}
        />
        <ChoiceRow
          title="垂直位置"
          description="侧栏在屏幕上的高度位置"
          value={settings.align}
          choices={[
            { value: 'center', label: '居中' },
            { value: 'top', label: '顶部' },
            { value: 'bottom', label: '底部' },
          ]}
          onChange={next => {
            write('align', next)
          }}
        />
        <SliderRow
          title="静置透明度"
          description="未悬停时的透明度，越低越不干扰阅读"
          value={settings.restingOpacity}
          min={20}
          max={100}
          suffix="%"
          onChange={next => {
            write('restingOpacity', next)
          }}
        />
        <ToggleRow
          title="让开轮次导航条"
          description="侧栏与对话轮次导航条重叠时，把导航条向左推开，而不是遮住它"
          checked={settings.yieldToTurnNav}
          onChange={next => {
            write('yieldToTurnNav', next)
          }}
        />
      </section>

      <section className={css.group}>
        <h3 className={css.groupTitle}>数据</h3>
        <SliderRow
          title="刷新间隔"
          description="超过该时间后再次读取各提供商额度"
          value={settings.refreshSeconds}
          min={15}
          max={600}
          step={15}
          suffix=" 秒"
          onChange={next => {
            write('refreshSeconds', next)
          }}
        />
        <div className={css.row}>
          <span className={css.rowText}>
            <span className={css.rowTitle}>立即刷新</span>
            <span className={css.rowDesc}>
              {snapshot === undefined
                ? '尚未读取'
                : `上次读取 ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`}
            </span>
          </span>
          <button type="button" className={css.button} onClick={refresh} disabled={busy}>
            {busy ? '读取中…' : '刷新'}
          </button>
        </div>
      </section>

      <section className={css.group}>
        <h3 className={css.groupTitle}>提供商</h3>
        <p className={css.groupHint}>
          勾选要在侧栏显示的提供商。顺序即侧栏中的排列顺序，可用箭头调整。
        </p>
        <ul className={css.providerList}>
          {chosen.map((id, index) => renderRow(id, index, chosen.length))}
          {rest.map(id => renderRow(id, -1, 0))}
        </ul>
      </section>
    </div>
  )
}
