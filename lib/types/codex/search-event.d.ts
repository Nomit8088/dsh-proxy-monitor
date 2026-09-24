/** Durable request event owned by the OpenAI Codex search provider. */
import type { Context } from '@deepseek-ai/cordis';
import type { OpenAICodexSearchRequestRecord } from './search.js';
/** Dedicated log event written before an OpenAI Codex search dispatch. */
export declare const OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT = "web/openai-codex-search-llm-request";
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** Exact secret-free OpenAI Codex standalone-search request. */
        'web/openai-codex-search-llm-request': OpenAICodexSearchRequestRecord;
    }
}
/**
 * Register the plugin-owned event in the running Harness vocabulary. The
 * public DSH build exports its known-event collection as read-only because
 * core code must not mutate it accidentally; the runtime value is the Set
 * deliberately consulted on every persistence read. Registration remains for
 * the process lifetime so sessions written before an HMR cycle stay readable.
 */
export declare function installOpenAICodexSearchEvent(): void;
/**
 * Append one resolved request to the initiating agent's session. Searches
 * outside an agent turn have no owning session and therefore produce no log.
 * @param ctx - plugin context carrying the optional active-agent service.
 * @param request - exact request after defaults, excluding credentials.
 */
export declare function recordOpenAICodexSearchRequest(ctx: Context, request: OpenAICodexSearchRequestRecord): void;
