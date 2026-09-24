/**
 * Install an LLM adapter even when a leftover standalone bundle already
 * claimed the route. `registerAdapter` throws DUPLICATE_ADAPTER; this
 * replaces the slot in place so the model picker and stream dispatch both
 * see our catalog.
 */
import type { LlmAdapter } from '@deepseek-ai/dsh-llm';
interface AdapterSlot {
    adapter: LlmAdapter;
    provider: {
        id: string;
        name: string;
    };
}
interface LlmRegistry {
    adapters?: Map<string, AdapterSlot>;
    emitAdaptersUpdated?: () => void;
    registerAdapter: (providers: string[], adapter: LlmAdapter) => unknown;
    listProviders: () => Array<{
        id: string;
    }>;
}
/** Put `adapter` on `provider`, stealing the leftover bundle's slot if needed. */
export declare function installOrTakeOverAdapter(llm: LlmRegistry, provider: string, adapter: LlmAdapter, log: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
}): 'registered' | 'taken-over' | 'failed';
/** Wrap listModels/resolveModel on a leftover adapter without replacing stream. */
export declare function wrapAdapterCatalog(llm: LlmRegistry, provider: string, wrap: {
    listModels: (original: LlmAdapter['listModels'], provider: string) => ReturnType<LlmAdapter['listModels']>;
    resolveModel: (original: LlmAdapter['resolveModel'], provider: string, model: string, signal?: AbortSignal) => ReturnType<LlmAdapter['resolveModel']>;
}, log: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
}): boolean;
export {};
