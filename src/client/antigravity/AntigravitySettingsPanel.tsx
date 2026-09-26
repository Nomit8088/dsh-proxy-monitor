/**
 * Antigravity model catalog inside the unified reverse-proxy settings tab.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/antigravity/AntigravitySettingsPanel
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'

import {
  ModelCatalogPanel,
  optionSupportsImages,
  type ModelCatalogOption,
} from '../models/ModelCatalogPanel.js'

const MODELS_PATH = '/antigravity/api/models'
const QUOTA_PATH = '/antigravity/api/quota'

interface ModelCatalog {
  enabledModelIds: string[]
  imageModelIds?: string[]
  options: ModelCatalogOption[]
}

class CatalogRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogRequestError'
  }
}

/** Explain Google's account gate without suggesting a different model id can bypass it. */
function refreshReason(message: string): string {
  return /verify your account to continue/i.test(message)
    ? `Google 要求此账号先完成验证；OAuth 登录成功只证明有凭据，不代表已获 Cloud Code Assist 额度/模型权限。请按 Google 的提示验证账号后再刷新。${message}`
    : message
}

async function jsonRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  const envelope = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  if (!response.ok || envelope?.['ok'] === false) {
    const error = envelope?.['error']
    throw new CatalogRequestError(typeof error === 'string' ? error : `HTTP ${String(response.status)}`)
  }
  return (envelope?.['value'] ?? value) as T
}

/** Live Antigravity model catalog with enable and image-support toggles. */
export function AntigravitySettingsPanel(): ReactNode {
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async (refreshLive: boolean) => {
    setBusy(true)
    setError(undefined)
    let refreshFailure: string | undefined
    try {
      if (refreshLive) {
        try {
          const quota = await jsonRequest<{ models?: ModelCatalog; catalogError?: string }>(QUOTA_PATH, 'POST')
          if (quota.models !== undefined) {
            setCatalog(quota.models)
            if (quota.catalogError) {
              setError(`额度已读取，但活体模型目录刷新失败（仅显示上次保存的列表，如有）：${refreshReason(quota.catalogError)}`)
            }
            return
          }
          refreshFailure = '额度接口没有返回模型目录'
        } catch (caught) {
          refreshFailure = caught instanceof Error ? caught.message : String(caught)
        }
      }
      setCatalog(await jsonRequest<ModelCatalog>(MODELS_PATH))
      if (refreshFailure) {
        setError(`活体刷新失败，显示上次保存的目录；不能据此认定模型仍可用：${refreshReason(refreshFailure)}`)
      }
    } catch (caught) {
      const savedError = caught instanceof Error ? caught.message : String(caught)
      setError(refreshFailure ? `活体刷新失败：${refreshReason(refreshFailure)}；读取本地目录也失败：${savedError}` : savedError)
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
      setCatalog(await jsonRequest<ModelCatalog>(MODELS_PATH, 'POST', { enabledModelIds, imageModelIds }))
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
      note="勾选即自动保存。同池模型共享 5 小时与每周额度窗口。重新打开模型选择器即可看到最新列表；运行中的旧会话不受影响。"
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
