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
import type { Api, Model } from '@earendil-works/pi-ai';
/** Official Codex account model listing. */
export declare const LIVE_CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
/** Facts one live listing entry contributes to a synthesized model. */
export interface LiveCodexModelFact {
    id: string;
    name: string;
    contextWindow?: number;
}
/**
 * Extract chat-model facts from a Codex `/codex/models` payload.
 * Unknown shapes yield an empty list rather than failing the listing.
 */
export declare function parseLiveCodexModels(payload: unknown): LiveCodexModelFact[];
/** `gpt-6-luna` → `Gpt 6 Luna`. */
export declare function liveCodexModelName(id: string): string;
/** Prefer a same-family template, then any reasoning Codex model. */
export declare function templateForLiveCodexModel(base: readonly Model<Api>[], id: string): Model<Api> | undefined;
/** Clone the template into a descriptor for one discovered model. */
export declare function synthesizeCodexModel(template: Model<Api>, fact: LiveCodexModelFact): Model<Api>;
/** Merge live facts onto the installed catalog without mutating curated entries. */
export declare function mergeLiveCodexModels(base: readonly Model<Api>[], facts: readonly LiveCodexModelFact[]): Model<Api>[];
/** Auth material one listing fetch needs. */
export interface CodexLiveAuth {
    accessToken: string;
    accountId: string;
}
/** Options one catalog instance is constructed with. */
export interface CodexLiveModelCatalogOptions {
    resolveAuth: () => Promise<CodexLiveAuth | undefined>;
    fetchImpl?: typeof fetch;
    warn?: (message: string) => void;
    onChange?: () => void;
}
/**
 * Best-effort live overlay. `merge` is synchronous (pi-ai `getModels` is), so
 * a fetch is kicked in the background and its result reaches the next catalog
 * read; `refresh` waits for one attempt.
 */
export declare class CodexLiveModelCatalog {
    private readonly options;
    private facts;
    private knownIds;
    private inflight;
    constructor(options: CodexLiveModelCatalogOptions);
    /** Installed catalog plus a synthesized entry per missing discovered model. */
    merge(base: readonly Model<Api>[]): Model<Api>[];
    /** Force a listing fetch and wait for it to settle. */
    refresh(): Promise<readonly LiveCodexModelFact[]>;
    private ensureFresh;
    private fetchOnce;
}
