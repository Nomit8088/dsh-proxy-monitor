/** Codex WebSocket transport selection and native compaction experiments. */
import type { FetchFunction, Provider } from '@earendil-works/pi-ai';
import type { ResponseApiPreferences } from './tool-policy.js';
/** Responses endpoint used by the official Codex client, including V2 compaction. */
export declare const OPENAI_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
/** Replace a framed Harness checkpoint with the native items it durably carries. */
export declare function expandNativeCompactionMarkers(input: readonly unknown[]): unknown[];
/** Mutable request policy shared by the Harness adapter and its pi-ai provider. */
export declare class OpenAICodexResponseRuntime {
    private readonly preferences;
    private readonly requestFetch;
    private readonly compactionCalls;
    constructor(preferences: () => ResponseApiPreferences, requestFetch?: FetchFunction);
    /** Mark one Harness stream call as compaction until its iterator closes. */
    enterCompaction(sessionId: string | undefined): () => void;
    /** Add Codex-only request behavior without changing the provider catalog or OAuth flow. */
    wrap(provider: Provider): Provider;
    private streamSimple;
    private standardStream;
    private nativeCompactionStream;
    private requestNativeCompaction;
}
