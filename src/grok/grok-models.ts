/**
 * Live model discovery for the xai route. The installed pi-ai catalog is a
 * static snapshot pinned by the harness's pi-ai version, so newly released
 * Grok models (and account-visible variants) are missing until pi-ai
 * upgrades. This module fetches the account's real model list from the
 * official `GET https://api.x.ai/v1/models` endpoint with the subscription
 * OAuth token and synthesizes catalog entries for chat models the installed
 * catalog does not ship, cloning a curated catalog entry as the template so
 * every synthesized descriptor stays structurally valid for pi-ai.
 *
 * Curated catalog entries are never modified: they carry hand-maintained
 * facts (wire protocol, reasoning dialects, compat switches) the live
 * endpoint cannot answer. Discovery only appends.
 *
 * @module dsh-grok-auth/grok-models
 */

import type { Api, Model } from '@earendil-works/pi-ai'
import { readBoundedResponseText } from './bounded-response.js'

/** The official xAI model listing for the authenticated account. */
export const LIVE_MODELS_ENDPOINT = 'https://api.x.ai/v1/models'

/** How long one successful listing serves before a re-fetch. */
const LIVE_MODELS_TTL_MS = 30 * 60 * 1000

/** Back-off after a failed or unauthenticated fetch attempt. */
const LIVE_MODELS_RETRY_MS = 60 * 1000

/** Host-owned deadline for one listing fetch. */
const LIVE_MODELS_TIMEOUT_MS = 10_000

/** Hard cap for the listing envelope; the real payload is a few kilobytes. */
const LIVE_MODELS_MAX_BYTES = 256 * 1024

/** The price fields' unit: 1e-4 USD per million tokens. */
const PRICE_UNITS_PER_USD = 10_000

/** The facts one live listing entry contributes to a synthesized model. */
export interface LiveModelFact {
  id: string
  contextWindow?: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
  }
}

/**
 * Extract chat-model facts from a `/v1/models` payload. Image and video
 * generation models (`grok-imagine-*`) are not chat models and are skipped;
 * malformed entries are skipped rather than failing the whole listing.
 */
export function parseLiveModels(payload: unknown): LiveModelFact[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return []
  const facts: LiveModelFact[] = []
  for (const entry of payload.data) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) continue
    if (entry.id.includes('imagine')) continue
    const contextWindow = positive(entry.context_length)
    const input = price(entry.prompt_text_token_price)
    const output = price(entry.completion_text_token_price)
    const cacheRead = price(entry.cached_prompt_text_token_price)
    const cost = {
      ...input === undefined ? {} : { input },
      ...output === undefined ? {} : { output },
      ...cacheRead === undefined ? {} : { cacheRead },
    }
    facts.push({
      id: entry.id,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...Object.keys(cost).length === 0 ? {} : { cost },
    })
  }
  return facts
}

/** `grok-4.20-0309-reasoning` → `Grok 4.20 0309 Reasoning`. */
export function liveModelName(id: string): string {
  return id
    .split('-')
    .map(part => part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part)
    .join(' ')
}

/**
 * Clone the template catalog entry into a descriptor for one discovered
 * model. The template contributes every hand-maintained field (protocol,
 * modalities, compat switches, output cap); the live fact contributes
 * identity, capacity, and pricing. A `non-reasoning` id clears the
 * template's reasoning flag.
 */
export function synthesizeModel(template: Model<Api>, fact: LiveModelFact): Model<Api> {
  return {
    ...template,
    id: fact.id,
    name: liveModelName(fact.id),
    ...fact.id.includes('non-reasoning') ? { reasoning: false } : {},
    ...fact.contextWindow === undefined ? {} : { contextWindow: fact.contextWindow },
    ...fact.cost === undefined || template.cost === undefined
      ? {}
      : { cost: { ...template.cost, ...fact.cost } },
  }
}

/** Options one catalog instance is constructed with. */
export interface GrokModelCatalogOptions {
  /** Resolve the OAuth access token for one listing fetch; `undefined` skips the attempt. */
  resolveAccessToken: () => Promise<string | undefined>
  /** Injectable transport for tests. */
  fetchImpl?: typeof fetch
  /** Listing freshness ceiling; primarily injectable for tests. */
  ttlMs?: number
  /** Back-off after a failed attempt; primarily injectable for tests. */
  retryMs?: number
  /** Sink for non-secret diagnostics. */
  warn?: (message: string) => void
  /** Observe the discovered id set changing (new models became available). */
  onChange?: () => void
}

/**
 * Best-effort live overlay over the installed catalog. `merge` is synchronous
 * (pi-ai's `getModels` is), so a fetch is kicked in the background and its
 * result reaches the next catalog read; the `onChange` hook lets the plugin
 * re-announce the route so configuration surfaces pick the new models up.
 */
export class GrokModelCatalog {
  private facts: readonly LiveModelFact[] = []
  private knownIds = ''
  private nextAttemptAt = 0
  private inflight: Promise<void> | undefined

  constructor(private readonly options: GrokModelCatalogOptions) {}

  /** Force a listing fetch, waiting for it to settle. */
  async refresh(): Promise<void> {
    this.nextAttemptAt = 0
    this.ensureFresh()
    await this.inflight
  }

  /** The installed catalog plus a synthesized entry per missing discovered model. */
  merge(base: readonly Model<Api>[]): readonly Model<Api>[] {
    this.ensureFresh()
    if (this.facts.length === 0) return base
    const known = new Set(base.map(model => model.id))
    const template = base.find(model => model.api === 'openai-completions' && model.reasoning === true)
      ?? base[0]
    if (template === undefined) return base
    const extra = this.facts
      .filter(fact => !known.has(fact.id))
      .map(fact => synthesizeModel(template, fact))
    return extra.length === 0 ? base : [...base, ...extra]
  }

  /** Kick one background listing fetch when the cached facts are stale. */
  private ensureFresh(): void {
    if (this.inflight !== undefined || Date.now() < this.nextAttemptAt) return
    const flight = this.fetchOnce().catch(() => {}).finally(() => {
      if (this.inflight === flight) this.inflight = undefined
    })
    this.inflight = flight
  }

  private async fetchOnce(): Promise<void> {
    // Assume failure; a completed parse below extends to the success TTL.
    this.nextAttemptAt = Date.now() + (this.options.retryMs ?? LIVE_MODELS_RETRY_MS)
    let accessToken: string | undefined
    try {
      accessToken = await this.options.resolveAccessToken()
    } catch {
      return
    }
    if (accessToken === undefined) return
    try {
      const response = await (this.options.fetchImpl ?? fetch)(LIVE_MODELS_ENDPOINT, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          'user-agent': 'dsh-grok-auth/0.1.1',
        },
        signal: AbortSignal.timeout(LIVE_MODELS_TIMEOUT_MS),
      })
      if (!response.ok) {
        try { await response.body?.cancel() } catch { /* best effort */ }
        this.options.warn?.(`live model listing answered ${response.status}`)
        return
      }
      const text = await readBoundedResponseText(response, LIVE_MODELS_MAX_BYTES, undefined, {
        tooLarge: () => new Error('live model listing exceeded the size limit'),
      })
      const facts = parseLiveModels(JSON.parse(text) as unknown)
      this.facts = facts
      this.nextAttemptAt = Date.now() + (this.options.ttlMs ?? LIVE_MODELS_TTL_MS)
      const ids = facts.map(fact => fact.id).sort().join(',')
      if (ids !== this.knownIds) {
        this.knownIds = ids
        this.options.onChange?.()
      }
    } catch (error) {
      this.options.warn?.(
        `live model listing failed (${error instanceof Error ? error.name : 'Error'}); serving the installed catalog`,
      )
    }
  }
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function price(value: unknown): number | undefined {
  const raw = positive(value)
  return raw === undefined ? undefined : raw / PRICE_UNITS_PER_USD
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
