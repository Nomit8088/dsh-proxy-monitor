/**
 * Install an LLM adapter even when a leftover standalone bundle already
 * claimed the route. `registerAdapter` throws DUPLICATE_ADAPTER; this
 * replaces the slot in place so the model picker and stream dispatch both
 * see our catalog.
 */

import type { LlmAdapter } from '@deepseek-ai/dsh-llm'

interface AdapterSlot {
  adapter: LlmAdapter
  provider: { id: string; name: string }
}

interface LlmRegistry {
  adapters?: Map<string, AdapterSlot>
  emitAdaptersUpdated?: () => void
  registerAdapter: (providers: string[], adapter: LlmAdapter) => unknown
  listProviders: () => Array<{ id: string }>
}

/** Put `adapter` on `provider`, stealing the leftover bundle's slot if needed. */
export function installOrTakeOverAdapter(
  llm: LlmRegistry,
  provider: string,
  adapter: LlmAdapter,
  log: { info: (message: string, ...args: unknown[]) => void; warn: (message: string, ...args: unknown[]) => void },
): 'registered' | 'taken-over' | 'failed' {
  const already = llm.listProviders().some(entry => entry.id === provider)
  if (!already) {
    llm.registerAdapter([provider], adapter)
    log.info('dsh-proxy-monitor: registered %s LLM adapter.', provider)
    return 'registered'
  }
  const slot = llm.adapters?.get(provider)
  if (slot === undefined) {
    log.warn('dsh-proxy-monitor: %s is claimed but the adapter map is not reachable; model picker will keep the leftover bundle.', provider)
    return 'failed'
  }
  slot.adapter = adapter
  try {
    llm.emitAdaptersUpdated?.()
  } catch {
    /* picker refresh is best-effort */
  }
  log.info('dsh-proxy-monitor: took over %s LLM adapter from a leftover bundle.', provider)
  return 'taken-over'
}

/** Wrap listModels/resolveModel on a leftover adapter without replacing stream. */
export function wrapAdapterCatalog(
  llm: LlmRegistry,
  provider: string,
  wrap: {
    listModels: (
      original: LlmAdapter['listModels'],
      provider: string,
    ) => ReturnType<LlmAdapter['listModels']>
    resolveModel: (
      original: LlmAdapter['resolveModel'],
      provider: string,
      model: string,
      signal?: AbortSignal,
    ) => ReturnType<LlmAdapter['resolveModel']>
  },
  log: { info: (message: string, ...args: unknown[]) => void; warn: (message: string, ...args: unknown[]) => void },
): boolean {
  const slot = llm.adapters?.get(provider)
  if (slot === undefined) {
    log.warn('dsh-proxy-monitor: cannot wrap %s catalog; leftover adapter not found.', provider)
    return false
  }
  const inner = slot.adapter
  const originalList = inner.listModels.bind(inner)
  const originalResolve = inner.resolveModel.bind(inner)
  inner.listModels = (id: string) => wrap.listModels(originalList, id)
  inner.resolveModel = (id: string, model: string, signal?: AbortSignal) =>
    wrap.resolveModel(originalResolve, id, model, signal)
  try {
    llm.emitAdaptersUpdated?.()
  } catch {
    /* best-effort */
  }
  log.info('dsh-proxy-monitor: wrapped %s leftover adapter catalog.', provider)
  return true
}
