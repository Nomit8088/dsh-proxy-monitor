/**
 * Live Codex model discovery from chatgpt.com.
 *
 * The installed pi-ai catalog is a static snapshot. Newly released models
 * (`gpt-6-luna`, `gpt-6-sol`, …) are missing until pi-ai upgrades. This module
 * fetches `GET https://chatgpt.com/backend-api/codex/models` with the ChatGPT
 * OAuth token and synthesizes catalog entries the installed catalog does not
 * ship, cloning a curated entry as the template.
 *
 * @module @dsh-external/dsh-proxy-monitor/codex/live-models
 */

import type { Api, Model } from '@earendil-works/pi-ai'

/** Official Codex account model listing. */
export const LIVE_CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'

const LIVE_MODELS_TIMEOUT_MS = 12_000
const LIVE_MODELS_MAX_BYTES = 512 * 1024

/** Facts one live listing entry contributes to a synthesized model. */
export interface LiveCodexModelFact {
  id: string
  name: string
  contextWindow?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function slugOf(entry: Record<string, unknown>): string | undefined {
  for (const key of ['slug', 'id', 'model', 'name'] as const) {
    const value = entry[key]
    if (typeof value === 'string' && value.length > 0 && !/\s/.test(value)) return value
  }
  return undefined
}

/**
 * Extract chat-model facts from a Codex `/codex/models` payload.
 * Unknown shapes yield an empty list rather than failing the listing.
 */
export function parseLiveCodexModels(payload: unknown): LiveCodexModelFact[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.models)
      ? payload.models
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : []
  const facts: LiveCodexModelFact[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = slugOf(row)
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const name =
      (typeof row.display_name === 'string' && row.display_name.length > 0 ? row.display_name : undefined)
      ?? (typeof row.name === 'string' && row.name.length > 0 ? row.name : undefined)
      ?? liveCodexModelName(id)
    const contextWindow = positive(row.context_window) ?? positive(row.max_context_window) ?? positive(row.contextWindow)
    facts.push({
      id,
      name,
      ...contextWindow === undefined ? {} : { contextWindow },
    })
  }
  return facts
}

/** `gpt-6-luna` → `Gpt 6 Luna`. */
export function liveCodexModelName(id: string): string {
  return id
    .split('-')
    .map(part => part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part)
    .join(' ')
    .replace(/^Gpt /u, 'GPT ')
}

/** Prefer a same-family template, then any reasoning Codex model. */
export function templateForLiveCodexModel(base: readonly Model<Api>[], id: string): Model<Api> | undefined {
  const lower = id.toLowerCase()
  const family =
    lower.includes('luna') ? base.find(model => model.id.includes('luna'))
    : lower.includes('sol') ? base.find(model => model.id.includes('sol'))
    : lower.includes('astra') ? base.find(model => model.id.includes('astra'))
    : undefined
  return family
    ?? base.find(model => model.id === 'gpt-6-astra')
    ?? base.find(model => model.id.includes('gpt-5.6-sol'))
    ?? base[0]
}

/** Clone the template into a descriptor for one discovered model. */
export function synthesizeCodexModel(template: Model<Api>, fact: LiveCodexModelFact): Model<Api> {
  return {
    ...template,
    id: fact.id,
    name: fact.name,
    input: ['text', 'image'],
    ...fact.contextWindow === undefined ? {} : { contextWindow: fact.contextWindow },
  }
}

/** Merge live facts onto the installed catalog without mutating curated entries. */
export function mergeLiveCodexModels(
  base: readonly Model<Api>[],
  facts: readonly LiveCodexModelFact[],
): Model<Api>[] {
  if (facts.length === 0) return [...base]
  const known = new Set(base.map(model => model.id))
  const extra: Model<Api>[] = []
  for (const fact of facts) {
    if (known.has(fact.id)) continue
    const template = templateForLiveCodexModel(base, fact.id)
    if (template === undefined) continue
    extra.push(synthesizeCodexModel(template, fact))
    known.add(fact.id)
  }
  return extra.length === 0 ? [...base] : [...base, ...extra]
}

/** Auth material one listing fetch needs. */
export interface CodexLiveAuth {
  accessToken: string
  accountId: string
}

/** Options one catalog instance is constructed with. */
export interface CodexLiveModelCatalogOptions {
  resolveAuth: () => Promise<CodexLiveAuth | undefined>
  fetchImpl?: typeof fetch
  warn?: (message: string) => void
  onChange?: () => void
}

/**
 * Best-effort live overlay. `merge` is synchronous (pi-ai `getModels` is), so
 * a fetch is kicked in the background and its result reaches the next catalog
 * read; `refresh` waits for one attempt.
 */
export class CodexLiveModelCatalog {
  private facts: readonly LiveCodexModelFact[] = []
  private knownIds = ''
  private inflight: Promise<void> | undefined

  constructor(private readonly options: CodexLiveModelCatalogOptions) {}

  /** Installed catalog plus a synthesized entry per missing discovered model. */
  merge(base: readonly Model<Api>[]): Model<Api>[] {
    this.ensureFresh()
    return mergeLiveCodexModels(base, this.facts)
  }

  /** Force a listing fetch and wait for it to settle. */
  async refresh(): Promise<readonly LiveCodexModelFact[]> {
    this.inflight = undefined
    await this.fetchOnce()
    return this.facts
  }

  private ensureFresh(): void {
    if (this.inflight !== undefined) return
    const flight = this.fetchOnce().catch(() => {}).finally(() => {
      if (this.inflight === flight) this.inflight = undefined
    })
    this.inflight = flight
  }

  private async fetchOnce(): Promise<void> {
    let auth: CodexLiveAuth | undefined
    try {
      auth = await this.options.resolveAuth()
    } catch {
      return
    }
    if (auth === undefined) return
    try {
      const response = await (this.options.fetchImpl ?? fetch)(LIVE_CODEX_MODELS_URL, {
        method: 'GET',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          'chatgpt-account-id': auth.accountId,
          accept: 'application/json',
          'cache-control': 'no-store',
          'user-agent': 'dsh-openai-codex',
        },
        signal: AbortSignal.timeout(LIVE_MODELS_TIMEOUT_MS),
      })
      if (!response.ok) {
        try { await response.body?.cancel() } catch { /* best effort */ }
        this.options.warn?.(`live Codex model listing answered ${String(response.status)}`)
        return
      }
      const text = await response.text()
      if (text.length > LIVE_MODELS_MAX_BYTES) {
        this.options.warn?.('live Codex model listing exceeded the size limit')
        return
      }
      const facts = parseLiveCodexModels(JSON.parse(text) as unknown)
      this.facts = facts
      const ids = facts.map(fact => fact.id).sort().join(',')
      if (ids !== this.knownIds) {
        this.knownIds = ids
        this.options.onChange?.()
      }
    } catch (error) {
      this.options.warn?.(
        `live Codex model listing failed (${error instanceof Error ? error.name : 'Error'}); serving the installed catalog`,
      )
    }
  }
}
