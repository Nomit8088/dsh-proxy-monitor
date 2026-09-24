/**
 * Shared model catalog: enable/disable each model and declare image input
 * so DSH does not intercept attachments (`projectImagesForTextModel`).
 *
 * @module @dsh-external/dsh-proxy-monitor/client/models/ModelCatalogPanel
 */

import type { ReactNode } from 'react'

import css from './ModelCatalogPanel.module.css'

/** One row in the shared catalog. */
export interface ModelCatalogOption {
  id: string
  name?: string
  enabled: boolean
  supportsImages?: boolean
  inputModalities?: readonly string[]
  reasoningEfforts?: readonly string[]
  remainingPercent?: number
  meta?: string
}

/** Props of the shared catalog panel. */
export interface ModelCatalogPanelProps {
  title?: string
  lead?: string
  note?: string
  empty?: string
  options: readonly ModelCatalogOption[]
  busy: boolean
  error?: string | undefined
  onRefresh?: () => void
  onToggleEnabled: (id: string, enabled: boolean) => void
  onToggleImage: (id: string, supportsImages: boolean) => void
  onSetAllEnabled: (enabled: boolean) => void
}

/** Whether this option should declare image input to DSH. */
export function optionSupportsImages(option: ModelCatalogOption): boolean {
  if (typeof option.supportsImages === 'boolean') return option.supportsImages
  return Array.isArray(option.inputModalities) && option.inputModalities.includes('image')
}

function optionMeta(option: ModelCatalogOption): string {
  if (option.meta !== undefined && option.meta.length > 0) return option.meta
  const parts = [option.id]
  if (Array.isArray(option.reasoningEfforts) && option.reasoningEfforts.length > 0) {
    parts.push(`thinking: ${option.reasoningEfforts.join('/')}`)
  }
  if (typeof option.remainingPercent === 'number') {
    parts.push(`额度 ${String(option.remainingPercent)}%`)
  }
  return parts.join(' · ')
}

function ModelRow({
  option,
  busy,
  onToggleEnabled,
  onToggleImage,
}: {
  option: ModelCatalogOption
  busy: boolean
  onToggleEnabled: (id: string, enabled: boolean) => void
  onToggleImage: (id: string, supportsImages: boolean) => void
}): ReactNode {
  const supportsImages = optionSupportsImages(option)
  return (
    <div className={css.row} data-enabled={option.enabled ? 'true' : 'false'}>
      <input
        className={css.check}
        type="checkbox"
        checked={option.enabled}
        disabled={busy}
        aria-label={`在模型选择器中显示 ${option.name ?? option.id}`}
        onChange={event => { onToggleEnabled(option.id, event.target.checked) }}
      />
      <div className={css.body}>
        <span className={css.name}>{option.name ?? option.id}</span>
        <span className={css.meta}>{optionMeta(option)}</span>
      </div>
      <label className={css.imageToggle}>
        <input
          type="checkbox"
          checked={supportsImages}
          disabled={busy}
          aria-label={`${option.name ?? option.id} 支持图像`}
          onChange={event => { onToggleImage(option.id, event.target.checked) }}
        />
        支持图像
      </label>
    </div>
  )
}

const DEFAULT_LEAD =
  '从当前账号动态拉取，而不是写死列表。勾选后出现在 DSH 模型选择器中；勾选「支持图像」后 DSH 不会把图片拦截成文本。'

const DEFAULT_NOTE =
  '勾选即自动保存。重新打开模型选择器即可看到最新列表；运行中的旧会话不受影响。'

/** Shared enable / image-support catalog used by every reverse-proxied provider. */
export function ModelCatalogPanel(props: ModelCatalogPanelProps): ReactNode {
  const {
    title = '可用模型',
    lead = DEFAULT_LEAD,
    note = DEFAULT_NOTE,
    empty,
    options,
    busy,
    error,
    onRefresh,
    onToggleEnabled,
    onToggleImage,
    onSetAllEnabled,
  } = props
  const emptyText = empty ?? (busy ? '正在加载模型…' : '暂无模型。登录后点击「刷新模型」从账号拉取。')

  return (
    <section className={css.panel}>
      <div className={css.head}>
        <div className={css.titleBlock}>
          <h3 className={css.title}>{title}</h3>
          <p className={css.lead}>{lead}</p>
        </div>
        <div className={css.actions}>
          {onRefresh === undefined ? null : (
            <button type="button" className={css.button} disabled={busy} onClick={onRefresh}>
              {busy ? '刷新中…' : '刷新模型'}
            </button>
          )}
          <button
            type="button"
            className={css.button}
            disabled={busy || options.length === 0}
            onClick={() => { onSetAllEnabled(true) }}
          >
            全选
          </button>
          <button
            type="button"
            className={css.button}
            disabled={busy || options.length === 0}
            onClick={() => { onSetAllEnabled(false) }}
          >
            全不选
          </button>
        </div>
      </div>

      {options.length === 0 ? (
        <p className={css.empty}>{emptyText}</p>
      ) : (
        <div className={css.list} role="group" aria-label={title}>
          {options.map(option => (
            <ModelRow
              key={option.id}
              option={option}
              busy={busy}
              onToggleEnabled={onToggleEnabled}
              onToggleImage={onToggleImage}
            />
          ))}
        </div>
      )}

      {error === undefined ? null : <p className={css.error}>{error}</p>}
      <p className={css.note}>{note}</p>
    </section>
  )
}
