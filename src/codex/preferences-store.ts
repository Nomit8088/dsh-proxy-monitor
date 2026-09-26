/**
 * File-backed OpenAI Codex preference document.
 *
 * The bundled Codex tree used to persist these values through a settings
 * namespace (`openai-codex`). DSH 0.1.7 removed plugin-declared namespaces —
 * the seam now projects a plugin entry's own `.volatile()` Config fields, keyed
 * by entry id — and these preferences could not live in that entry's Config
 * even if they wanted to: the schema depends on the *live* model catalog (the
 * enabled and vision defaults are whatever the provider just advertised), which
 * a fixed profile schema cannot express, and the credential sweep rewrites the
 * selection on every live listing, which against the entry Config would mean a
 * profile-patch write per sweep.
 *
 * They therefore live in their own document under the Harness home, beside the
 * Grok catalog preferences, with the same write discipline (temp file +
 * rename, serialized read-modify-write) and no process-lifetime cache that a
 * hot reload could strand.
 *
 * @module @dsh-external/dsh-proxy-monitor/codex/preferences-store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { resolveDshHome } from '../home.js'

/** One stored preference document: the raw user layer plus provenance. */
export interface OpenAICodexPreferenceDocument {
  /**
   * Stored values, exactly the keys a writer supplied. Merged over the schema
   * defaults and the composition base when it is resolved, never in place of
   * them, so a missing key means "inherit" rather than "erase".
   */
  values: Record<string, unknown>
  /** Epoch milliseconds of the last accepted write; 0 before any. */
  updatedAt: number
}

/** Absolute path of the preference document inside the Harness home. */
function preferencesPath(): string {
  return join(resolveDshHome(), 'storages', 'openai-codex-preferences.json')
}

/** Whether a value is a plain data object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Coerce one parsed document into the stored shape, discarding anything else. */
function normalize(raw: unknown): OpenAICodexPreferenceDocument {
  const record = isRecord(raw) ? raw : {}
  const values = isRecord(record['values']) ? { ...record['values'] } : {}
  return {
    values,
    updatedAt: typeof record['updatedAt'] === 'number' ? record['updatedAt'] : 0,
  }
}

/** File-backed Codex preferences; one instance per Host plugin fiber. */
export class OpenAICodexPreferenceStore {
  /** Absolute path this store reads and writes. */
  readonly path: string
  private cache: OpenAICodexPreferenceDocument | undefined
  /** Serialized read-modify-write chain, so two writers cannot interleave. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(file = preferencesPath()) {
    this.path = file
  }

  /** Last read or written document; an empty one before the first read. */
  snapshot(): OpenAICodexPreferenceDocument {
    return this.cache ?? { values: {}, updatedAt: 0 }
  }

  /**
   * Read the document, treating an absent file as an empty one.
   * @returns the parsed document.
   */
  async read(): Promise<OpenAICodexPreferenceDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      this.cache = normalize(parsed)
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') this.cache = normalize(undefined)
      else throw error
    }
    return this.snapshot()
  }

  /**
   * Replace the stored user layer.
   * @param values - the complete next user layer.
   * @returns the written document.
   */
  async write(values: Record<string, unknown>): Promise<OpenAICodexPreferenceDocument> {
    const payload: OpenAICodexPreferenceDocument = { values: { ...values }, updatedAt: Date.now() }
    await mkdir(dirname(this.path), { recursive: true })
    const tempFile = `${this.path}.tmp`
    await writeFile(tempFile, JSON.stringify(payload, null, 2), { mode: 0o600 })
    await rename(tempFile, this.path)
    this.cache = payload
    return payload
  }

  /**
   * Apply one edit to the current user layer under the write chain.
   * @param fn - receives the current document, returns the next user layer.
   * @returns the written document.
   */
  modify(
    fn: (
      current: OpenAICodexPreferenceDocument,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): Promise<OpenAICodexPreferenceDocument> {
    const next = (async () => {
      await this.chain.catch(() => {})
      const current = await this.read()
      return await this.write(await fn(current))
    })()
    this.chain = next.catch(() => {})
    return next
  }
}
