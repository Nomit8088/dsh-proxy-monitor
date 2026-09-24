/**
 * Install an LLM adapter even when a leftover standalone bundle already
 * claimed the route. `registerAdapter` throws DUPLICATE_ADAPTER; this
 * replaces the slot in place so the model picker and stream dispatch both
 * see our catalog.
 */
/** Put `adapter` on `provider`, stealing the leftover bundle's slot if needed. */
export function installOrTakeOverAdapter(llm, provider, adapter, log) {
    const already = llm.listProviders().some(entry => entry.id === provider);
    if (!already) {
        llm.registerAdapter([provider], adapter);
        log.info('dsh-proxy-monitor: registered %s LLM adapter.', provider);
        return 'registered';
    }
    const slot = llm.adapters?.get(provider);
    if (slot === undefined) {
        log.warn('dsh-proxy-monitor: %s is claimed but the adapter map is not reachable; model picker will keep the leftover bundle.', provider);
        return 'failed';
    }
    slot.adapter = adapter;
    try {
        llm.emitAdaptersUpdated?.();
    }
    catch {
        /* picker refresh is best-effort */
    }
    log.info('dsh-proxy-monitor: took over %s LLM adapter from a leftover bundle.', provider);
    return 'taken-over';
}
/**
 * Bookkeeping for one adapter we have already overlaid.
 *
 * The overlay mutates the adapter instance in place, so it must be idempotent:
 * a second wrap would stack a second filter and a second modality rewrite on
 * the same object. The marker also carries the disposer, so a caller that
 * re-checks on every topology change gets the same unwrap back instead of a
 * fresh (and useless) one.
 */
const OVERLAY = Symbol.for('@dsh-external/dsh-proxy-monitor/catalog-overlay');
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
export function wrapAdapterCatalog(llm, provider, wrap, log) {
    const slot = llm.adapters?.get(provider);
    if (slot === undefined) {
        log.warn('dsh-proxy-monitor: cannot wrap %s catalog; no adapter owns the route yet.', provider);
        return () => { };
    }
    const inner = slot.adapter;
    const existing = inner[OVERLAY];
    if (existing !== undefined)
        return existing.unwrap;
    const originalList = inner.listModels.bind(inner);
    const originalResolve = inner.resolveModel.bind(inner);
    const marker = {
        listModels: originalList,
        resolveModel: originalResolve,
        unwrap: () => {
            // A later wrap of the same instance owns the slot now; leave it alone.
            if (inner[OVERLAY] !== marker)
                return;
            inner.listModels = originalList;
            inner.resolveModel = originalResolve;
            delete inner[OVERLAY];
        },
    };
    inner.listModels = (id) => wrap.listModels(originalList, id);
    inner.resolveModel = (id, model, signal) => wrap.resolveModel(originalResolve, id, model, signal);
    inner[OVERLAY] = marker;
    try {
        llm.emitAdaptersUpdated?.();
    }
    catch {
        /* best-effort */
    }
    log.info('dsh-proxy-monitor: overlaying the %s adapter catalog.', provider);
    return marker.unwrap;
}
//# sourceMappingURL=llm-takeover.js.map