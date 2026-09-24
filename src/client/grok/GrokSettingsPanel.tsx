/**
 * Grok live model catalog inside the unified reverse-proxy settings tab.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/grok/GrokSettingsPanel
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'

import {
  ModelCatalogPanel,
  optionSupportsImages,
  type ModelCatalogOption,
} from '../models/ModelCatalogPanel.js'
import { catalogRequest } from '../models/catalog-request.js'

const MODELS_PATH = '/plugins/dsh-proxy-monitor/grok/models'

interface ModelCatalog {
  enabledModelIds: string[]
  imageModelIds?: string[]
  options: ModelCatalogOption[]
}

/** Live Grok model catalog with enable and image-support toggles. */
export function GrokSettingsPanel(): ReactNode {
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async (refreshLive: boolean) => {
    setBusy(true)
    setError(undefined)
    try {
      setCatalog(
        refreshLive
          ? await catalogRequest<ModelCatalog>(MODELS_PATH, 'POST', { refresh: true })
          : await catalogRequest<ModelCatalog>(MODELS_PATH),
      )
    } catch (caught) {
      try {
        setCatalog(await catalogRequest<ModelCatalog>(MODELS_PATH))
      } catch {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
  }, [load])

  const save = useCallback(async (enabledModelIds: string[], imageModelIds: string[]) => {
    setBusy(true)
    setError(undefined)
    try {
      setCatalog(await catalogRequest<ModelCatalog>(MODELS_PATH, 'POST', { enabledModelIds, imageModelIds }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [])

  const currentIds = useCallback(() => {
    const options = catalog?.options ?? []
    return {
      enabledModelIds: options.filter(option => option.enabled).map(option => option.id),
      imageModelIds: options.filter(optionSupportsImages).map(option => option.id),
    }
  }, [catalog])

  return (
    <ModelCatalogPanel
      options={catalog?.options ?? []}
      busy={busy}
      error={error}
      note="勾选即自动保存。列表来自 xAI 活体 /v1/models，而不是写死的 pi-ai 快照。重新打开模型选择器即可看到最新列表。"
      onRefresh={() => { void load(true) }}
      onToggleEnabled={(modelId, enabled) => {
        const current = new Set(currentIds().enabledModelIds)
        if (enabled) current.add(modelId)
        else current.delete(modelId)
        void save([...current], currentIds().imageModelIds)
      }}
      onToggleImage={(modelId, supportsImages) => {
        const current = new Set(currentIds().imageModelIds)
        if (supportsImages) current.add(modelId)
        else current.delete(modelId)
        void save(currentIds().enabledModelIds, [...current])
      }}
      onSetAllEnabled={enabled => {
        const options = catalog?.options ?? []
        void save(enabled ? options.map(option => option.id) : [], currentIds().imageModelIds)
      }}
    />
  )
}
