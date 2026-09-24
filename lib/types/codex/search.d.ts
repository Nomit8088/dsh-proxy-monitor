/**
 * OpenAI Codex standalone web search over the dsh web provider seam.
 * @module dsh-codex/search
 */
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import type { OpenAICodexCredentialStore } from './store.js';
/** Stable dsh web-provider id selected by the bundle patch. */
export declare const OPENAI_CODEX_SEARCH_PROVIDER = "openai-codex";
/** Trusted first-party Codex base; OAuth credentials never cross to a configured origin. */
export declare const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
/** Standalone search endpoint used by the official Codex client. */
export declare const OPENAI_CODEX_SEARCH_URL = "https://chatgpt.com/backend-api/codex/alpha/search";
/** Default model used by the standalone search endpoint. */
export declare const DEFAULT_OPENAI_CODEX_SEARCH_MODEL = "gpt-5.6-sol";
/** Default search mode, matching the official local Codex client. */
export declare const DEFAULT_OPENAI_CODEX_SEARCH_MODE = "cached";
/** Default provider search-context size. */
export declare const DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE = "medium";
/** Default output budget for the standalone search response. */
export declare const DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS = 10000;
/** Search modes accepted by the official standalone endpoint. */
export type OpenAICodexSearchMode = 'cached' | 'indexed' | 'live';
/** Provider search-context sizes accepted by the standalone endpoint. */
export type OpenAICodexSearchContextSize = 'low' | 'medium' | 'high';
interface SearchRequestBody {
    readonly id: string;
    readonly model: string;
    readonly input: readonly [
        {
            readonly type: 'message';
            readonly role: 'user';
            readonly content: readonly [{
                readonly type: 'input_text';
                readonly text: string;
            }];
        }
    ];
    readonly commands: {
        readonly search_query: readonly [{
            readonly q: string;
        }];
    };
    readonly settings: {
        readonly search_context_size: OpenAICodexSearchContextSize;
        readonly allowed_callers: readonly ['direct'];
        readonly external_web_access: boolean | 'indexed';
    };
    readonly max_output_tokens: number;
}
/** Exact secret-free request recorded before a standalone search dispatch. */
export interface OpenAICodexSearchRequestRecord {
    /** Fixed first-party endpoint. */
    readonly endpoint: typeof OPENAI_CODEX_SEARCH_URL;
    /** Exact JSON body sent to the provider. */
    readonly body: SearchRequestBody;
}
/** Fully resolved provider options. */
export interface OpenAICodexSearchProviderOptions {
    /** Shared persistent OAuth store. */
    readonly credentials: OpenAICodexCredentialStore;
    /** Request transport used after credentials have been resolved. */
    readonly fetch?: typeof globalThis.fetch;
    /** Model sent to the standalone search endpoint. */
    readonly model: string;
    /** Cached, indexed, or live external-web policy. */
    readonly mode: OpenAICodexSearchMode;
    /** Provider-side search context size. */
    readonly contextSize: OpenAICodexSearchContextSize;
    /** Upper bound on the standalone endpoint's generated output. */
    readonly maxOutputTokens: number;
    /** Resolve the request identity, normally the initiating session id. */
    readonly resolveRequestId: () => string;
    /** Record the exact secret-free request before dispatch. */
    readonly recordRequest?: (request: OpenAICodexSearchRequestRecord) => void;
}
/**
 * Map the standalone endpoint's forward-compatible result DTOs into the dsh
 * web result. Unknown DTO types and fields are ignored; malformed envelope
 * fields fail at the network boundary.
 * @param value - parsed response JSON.
 * @returns normalized answer and citeable sources.
 */
export declare function mapOpenAICodexSearchResponse(value: unknown): WebSearchResult;
/** OpenAI Codex standalone-search provider using the same refreshable OAuth store as the LLM route. */
export declare class OpenAICodexSearchProvider implements WebSearchProvider {
    private readonly options;
    readonly id = "openai-codex";
    private readonly models;
    /**
     * @param options - fixed trusted endpoint policy and deployment tunables.
     */
    constructor(options: OpenAICodexSearchProviderOptions);
    /** The local configuration is usable; credential presence is resolved per request. */
    available(): boolean;
    /** @inheritdoc */
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
export {};
