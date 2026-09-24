/**
 * Grok model enable / image-support preferences persisted under DSH home.
 *
 * @module @dsh-external/dsh-proxy-monitor/grok/model-settings
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  defaultImageModelIdsFrom,
  mergeEnabledModelIds,
  mergeImageModelIds,
  type CatalogModelRef,
} from '../catalog/preferences.js'
import { resolveDshHome } from '../home.js'

/** One row stored from the last live listing. */
export interface GrokCatalogModel extends CatalogModelRef {
  id: string
  name: string
}

/** On-disk Grok catalog preferences. */
export interface GrokModelPreferences {
  enabledModelIds: string[]
  imageModelIds: string[]
  catalogModels: GrokCatalogModel[]
  updatedAt: number
}

function settingsPath(): string {
  return join(resolveDshHome(), 'storages', 'grok-model-settings.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && !/\s/.test(id)))]
}

function normalize(raw: unknown): GrokModelPreferences {
  const record = isRecord(raw) ? raw : {}
  const catalogModels = Array.isArray(record['catalogModels'])
    ? record['catalogModels'].flatMap((entry): GrokCatalogModel[] => {
        if (!isRecord(entry) || typeof entry['id'] !== 'string' || entry['id'].length === 0) return []
        return [{
          id: entry['id'],
          name: typeof entry['name'] === 'string' ? entry['name'] : entry['id'],
          supportsImages: entry['supportsImages'] === true,
        }]
      })
    : []
  return {
    enabledModelIds: normalizeIdList(record['enabledModelIds']),
    imageModelIds: Array.isArray(record['imageModelIds'])
      ? normalizeIdList(record['imageModelIds'])
      : defaultImageModelIdsFrom(catalogModels),
    catalogModels,
    updatedAt: typeof record['updatedAt'] === 'number' ? record['updatedAt'] : 0,
  }
}

/** File-backed Grok model preferences. */
export class GrokModelSettingsStore {
  readonly path: string
  private cache: GrokModelPreferences | undefined
  private chain: Promise<unknown> = Promise.resolve()

  constructor(file = settingsPath()) {
    this.path = file
  }

  /** Last known preferences; empty until the first `read`. */
  snapshot(): GrokModelPreferences {
    return this.cache ?? {
      enabledModelIds: [],
      imageModelIds: [],
      catalogModels: [],
      updatedAt: 0,
    }
  }

  async read(): Promise<GrokModelPreferences> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      this.cache = normalize(parsed)
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') this.cache = normalize(undefined)
      else throw error
    }
    return this.snapshot()
  }

  async write(settings: GrokModelPreferences): Promise<GrokModelPreferences> {
    const normalized = normalize(settings)
    const payload = { ...normalized, updatedAt: Date.now() }
    await mkdir(dirname(this.path), { recursive: true })
    const tempFile = `${this.path}.tmp`
    await writeFile(tempFile, JSON.stringify(payload, null, 2), { mode: 0o600 })
    await rename(tempFile, this.path)
    this.cache = payload
    return payload
  }

  modify(fn: (current: GrokModelPreferences) => GrokModelPreferences | Promise<GrokModelPreferences>): Promise<GrokModelPreferences> {
    const next = (async () => {
      await this.chain.catch(() => {})
      const current = await this.read()
      return this.write(await fn(current))
    })()
    this.chain = next.catch(() => {})
    return next
  }

  /** Merge a live listing into stored enable / image selections. */
  async adoptLiveCatalog(catalogModels: GrokCatalogModel[]): Promise<GrokModelPreferences> {
    return this.modify(current => ({
      ...current,
      catalogModels,
      enabledModelIds: mergeEnabledModelIds(current, catalogModels),
      imageModelIds: mergeImageModelIds(current, catalogModels),
    }))
  }
}
