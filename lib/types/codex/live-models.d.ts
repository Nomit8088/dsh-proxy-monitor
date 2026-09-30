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
/**
 * Client version this plugin claims when listing models.
 *
 * The endpoint requires the `client_version` query parameter and answers 400
 * `Field required` without it, which is why an unparameterised fetch never
 * discovered anything. It then *gates the catalog by that version*: every entry
 * carries a `minimal_client_version`, and only entries at or below the claimed
 * version are returned.
 *
 * Measured against the live endpoint (account-dependent):
 *
 * | claimed  | newest entry returned   |
 * | -------- | ----------------------- |
 * | (absent)| HTTP 400, no listing    |
 * | 0.150.1  | gpt-5.6-*               |
 * | 0.153.0  | + gpt-6-astra           |
 * | 0.155.0  | + gpt-6-sol/luna        |
 * | 0.159.0  | + gpt-6.1-sol           |
 * | 1.0.0    | same full catalog       |
 * | 999.999.999 | same full catalog    |
 *
 * The gate is monotonic with no observed upper bound, and non-semver values
 * (`latest`) are rejected with `Invalid client_version format`. Claiming a
 * version above the shipped CLI is therefore what surfaces newly released
 * models; the value must stay semver, and an owner can override it in the
 * Codex settings when a future release outruns it.
 */
export declare const LIVE_CODEX_CLIENT_VERSION = "1.0.0";
/** Build the listing URL for a claimed client version. */
export declare function liveCodexModelsUrl(clientVersion?: string): string;
/** Facts one live listing entry contributes to a synthesized model. */
export interface LiveCodexModelFact {
    id: string;
    name: string;
    contextWindow?: number;
}
/**
 * Extract chat-model facts from a Codex `/codex/models` payload.
 * Unknown shapes yield an empty list rather than failing the listing.
 *
 * Entries carrying `visibility: "hide"` are skipped: that is upstream's own
 * signal that a model is internal (it returns `gpt-reserve` and
 * `codex-auto-review` that way), and the listing is the only place the plugin
 * learns about models pi-ai does not ship — so without this filter those two
 * would be synthesized straight into the user-facing picker.
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
/**
 * Outcome of the most recent listing attempt.
 *
 * The overlay is best-effort by design, so a failed listing is not fatal — but
 * it used to be *invisible*, which is what made "I hit refresh and the new
 * model never appeared" impossible to diagnose from the UI. This is the
 * measurement: `ok` plus either the reported model count or the reason.
 */
export interface LiveCodexListingStatus {
    /** Whether the last attempt produced a usable listing. */
    ok: boolean;
    /** When the attempt settled, epoch ms. */
    at: number;
    /** Client version claimed on the request. */
    clientVersion: string;
    /** Models the listing reported, once it succeeded. */
    count?: number;
    /** Why the attempt failed, when it did. */
    error?: string;
}
/** Options one catalog instance is constructed with. */
export interface CodexLiveModelCatalogOptions {
    resolveAuth: () => Promise<CodexLiveAuth | undefined>;
    fetchImpl?: typeof fetch;
    warn?: (message: string) => void;
    onChange?: () => void;
    /** Client version to claim; defaults to {@link LIVE_CODEX_CLIENT_VERSION}. */
    clientVersion?: string | (() => string);
    /** Observe each listing attempt, successful or not. */
    onStatus?: (status: LiveCodexListingStatus) => void;
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
    /** Publish one attempt's outcome without letting an observer break the fetch. */
    private report;
    /**
     * Resolve the version to claim for one attempt.
     *
     * Read per attempt rather than captured at construction: the settings layer
     * can change it while the plugin is live, and the next refresh must honour
     * that without a reload.
     */
    private clientVersion;
}
