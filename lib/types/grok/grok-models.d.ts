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
import type { Api, Model } from '@earendil-works/pi-ai';
/** The official xAI model listing for the authenticated account. */
export declare const LIVE_MODELS_ENDPOINT = "https://api.x.ai/v1/models";
/** The facts one live listing entry contributes to a synthesized model. */
export interface LiveModelFact {
    id: string;
    contextWindow?: number;
    cost?: {
        input?: number;
        output?: number;
        cacheRead?: number;
    };
}
/**
 * Extract chat-model facts from a `/v1/models` payload. Image and video
 * generation models (`grok-imagine-*`) are not chat models and are skipped;
 * malformed entries are skipped rather than failing the whole listing.
 */
export declare function parseLiveModels(payload: unknown): LiveModelFact[];
/** `grok-4.20-0309-reasoning` → `Grok 4.20 0309 Reasoning`. */
export declare function liveModelName(id: string): string;
/**
 * Clone the template catalog entry into a descriptor for one discovered
 * model. The template contributes every hand-maintained field (protocol,
 * modalities, compat switches, output cap); the live fact contributes
 * identity, capacity, and pricing. A `non-reasoning` id clears the
 * template's reasoning flag.
 */
export declare function synthesizeModel(template: Model<Api>, fact: LiveModelFact): Model<Api>;
/** Options one catalog instance is constructed with. */
export interface GrokModelCatalogOptions {
    /** Resolve the OAuth access token for one listing fetch; `undefined` skips the attempt. */
    resolveAccessToken: () => Promise<string | undefined>;
    /** Injectable transport for tests. */
    fetchImpl?: typeof fetch;
    /** Listing freshness ceiling; primarily injectable for tests. */
    ttlMs?: number;
    /** Back-off after a failed attempt; primarily injectable for tests. */
    retryMs?: number;
    /** Sink for non-secret diagnostics. */
    warn?: (message: string) => void;
    /** Observe the discovered id set changing (new models became available). */
    onChange?: () => void;
}
/**
 * Best-effort live overlay over the installed catalog. `merge` is synchronous
 * (pi-ai's `getModels` is), so a fetch is kicked in the background and its
 * result reaches the next catalog read; the `onChange` hook lets the plugin
 * re-announce the route so configuration surfaces pick the new models up.
 */
export declare class GrokModelCatalog {
    private readonly options;
    private facts;
    private knownIds;
    private nextAttemptAt;
    private inflight;
    constructor(options: GrokModelCatalogOptions);
    /** Force a listing fetch, waiting for it to settle. */
    refresh(): Promise<void>;
    /** The installed catalog plus a synthesized entry per missing discovered model. */
    merge(base: readonly Model<Api>[]): readonly Model<Api>[];
    /** Kick one background listing fetch when the cached facts are stale. */
    private ensureFresh;
    private fetchOnce;
}
