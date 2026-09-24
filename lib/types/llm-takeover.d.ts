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
/**
 * Wrap `listModels`/`resolveModel` on whichever adapter currently owns
 * `provider`, without replacing `stream`.
 *
 * The adapter is looked up at call time rather than captured, because the
 * order of "register the route" and "overlay its catalog" is not ours to
 * choose: a sibling module (or a later generation of this one) may register
 * after this call. A caller that re-invokes this on `llm/adapters-updated`
 * therefore always ends up overlaying the live instance — and a re-invocation
 * after the same instance is already overlaid is a no-op.
 *
 * @param llm - the LLM registry (its adapter map is read directly; the
 *   overlay seam has no public API by design).
 * @param provider - the route to overlay.
 * @param wrap - the overlay pair, each given the original bound method.
 * @param log - plugin logger.
 * @returns the disposer that restores the adapter's own methods. Calling it
 *   after the instance was replaced is harmless; calling it twice is harmless.
 */
export declare function wrapAdapterCatalog(llm: LlmRegistry, provider: string, wrap: {
    listModels: (original: LlmAdapter['listModels'], provider: string) => ReturnType<LlmAdapter['listModels']>;
    resolveModel: (original: LlmAdapter['resolveModel'], provider: string, model: string, signal?: AbortSignal) => ReturnType<LlmAdapter['resolveModel']>;
}, log: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
}): () => void;
export {};
