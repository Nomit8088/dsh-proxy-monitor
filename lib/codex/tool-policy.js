import z from "@deepseek-ai/schemastery";
import { OpenAICodexPreferenceStore } from "./preferences-store.js";
import { DEFAULT_PROXY_PREFERENCES, normalizeProxyUrl, } from "./proxy.js";
import { OPENAI_CODEX_PROVIDER } from "./store.js";
import { mergeEnabledModelIds, mergeImageModelIds, } from "../catalog/preferences.js";
/** Defaults keep generic vision-model interoperability enabled. */
export const DEFAULT_IMAGE_TOOL_PREFERENCES = {
    modifyReadImage: true,
    shareImagegenWithOtherModels: true,
};
/** Conservative defaults preserve the established stateless Harness behavior. */
export const DEFAULT_RESPONSE_API_PREFERENCES = {
    useWebSocketContextReuse: false,
    useNativeCompaction: false,
};
/** Keep provider-declared capacities until the owner opts into an override. */
export const DEFAULT_CONTEXT_WINDOW_PREFERENCES = {
    contextWindow: null,
    overrideSparkContextWindow: false,
};
/** Keep Fast Mode a per-session opt-in until the owner forces it globally. */
export const DEFAULT_FAST_MODE_PREFERENCES = {
    fastModeDefault: false,
};
/**
 * Resolve a stored preference document over this instance's defaults.
 *
 * The schema still owns validation and the defaults — including the
 * catalog-derived `models` / `imageModels` defaults — but nothing is registered
 * with the settings seam any more: the values live in this provider's own
 * document, and calling the schema fills every key that document omits, the way
 * the removed namespace registration used to layer the composition entry.
 */
function preferenceSchema(defaultModels, defaultImageModels) {
    return z.object({
        modifyReadImage: z.boolean().default(true),
        shareImagegenWithOtherModels: z.boolean().default(true),
        useWebSocketContextReuse: z.boolean().default(false),
        useStatefulResponses: z.boolean().default(false),
        useNativeCompaction: z.boolean().default(false),
        contextWindow: z
            .union([
            z.const(null),
            z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
        ])
            .default(null),
        overrideSparkContextWindow: z.boolean().default(false),
        proxyMode: z.union(["off", "scoped", "global"]).default("off"),
        proxyUrl: z.string().default(""),
        models: z.array(z.string()).default([...defaultModels]),
        imageModels: z.array(z.string()).default([...defaultImageModels]),
        fastModeDefault: z.boolean().default(false),
    });
}
/** Live policy shared by the host tools, Codex adapter, and settings HTTP surface. */
export class ImageToolPolicy {
    current;
    /** Durable preference document, written by this provider's own routes. */
    store = new OpenAICodexPreferenceStore();
    /** Diagnostic sink; rebound by `attach`. */
    warn = () => { };
    imageWatchers = new Set();
    proxyWatchers = new Set();
    catalogEntries;
    constructor(base = {}, modelCatalog = []) {
        this.catalogEntries = modelCatalog.map((model) => ({ ...model }));
        this.current = {
            ...DEFAULT_IMAGE_TOOL_PREFERENCES,
            ...DEFAULT_RESPONSE_API_PREFERENCES,
            ...DEFAULT_CONTEXT_WINDOW_PREFERENCES,
            ...DEFAULT_FAST_MODE_PREFERENCES,
            ...DEFAULT_PROXY_PREFERENCES,
            useStatefulResponses: false,
            ...base,
            models: this.normalizeModels(base.models ?? this.catalogEntries.map((model) => model.id)),
            imageModels: this.normalizeImageModels(base.imageModels ??
                this.catalogEntries
                    .filter((model) => model.supportsImages)
                    .map((model) => model.id)),
        };
        if (this.current.useStatefulResponses &&
            base.useWebSocketContextReuse === undefined) {
            this.current = { ...this.current, useWebSocketContextReuse: true };
        }
    }
    /**
     * Adopt the durable preference document.
     *
     * The stored document is the user layer alone; the schema resolves it over
     * the defaults this instance was constructed with, catalog-derived enable and
     * vision defaults included. The read is asynchronous, so a policy whose fiber
     * unloads first must not adopt its result, and an unreadable document must
     * leave the constructed defaults standing rather than failing the plugin.
     */
    attach(ctx) {
        this.warn = (message) => {
            ctx.logger.warn(message);
        };
        let detached = false;
        ctx.effect(() => () => {
            detached = true;
        }, "dsh-openai-codex: preferences");
        void this.store
            .read()
            .then((document) => {
            if (detached)
                return;
            this.replace(this.resolve(document));
        })
            .catch((error) => {
            this.warn(`OpenAI Codex preferences could not be read: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    /** Resolve one stored document over this instance's defaults. */
    resolve(document) {
        return preferenceSchema(this.current.models, this.current.imageModels)(document.values);
    }
    /**
     * Merge one patch into the stored user layer and adopt the resolved result.
     *
     * `undefined` patch entries are dropped, matching the merge semantics the
     * settings seam used: an absent key means "leave as is", never "erase".
     * @param patch - partial preferences written by the browser or a route.
     */
    async persist(patch) {
        const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
        const document = await this.store.modify((current) => ({
            ...current.values,
            ...Object.fromEntries(entries),
        }));
        this.replace(this.resolve(document));
    }
    /** Return a detached settings projection for the browser. */
    snapshot() {
        return {
            modifyReadImage: this.current.modifyReadImage,
            shareImagegenWithOtherModels: this.current.shareImagegenWithOtherModels,
        };
    }
    /** Observe live changes that add or remove the scoped `read_image` enhancement. */
    watchImagePreferences(listener) {
        this.imageWatchers.add(listener);
        return () => {
            this.imageWatchers.delete(listener);
        };
    }
    /** Persist a partial browser update into the preference document. */
    async update(patch) {
        await this.persist(patch);
        return this.snapshot();
    }
    /** Return the current Codex-only Responses API experiments. */
    responseApiSnapshot() {
        return {
            useWebSocketContextReuse: this.current.useWebSocketContextReuse,
            useNativeCompaction: this.current.useNativeCompaction,
        };
    }
    /** Persist a partial Responses API experiment update. */
    async updateResponseApi(patch) {
        await this.persist({
            ...patch,
            ...(patch.useWebSocketContextReuse === undefined
                ? {}
                : { useStatefulResponses: false }),
        });
        return this.responseApiSnapshot();
    }
    /** Return the live client-side context capacity override. */
    contextWindowSnapshot() {
        return {
            contextWindow: this.current.contextWindow,
            overrideSparkContextWindow: this.current.overrideSparkContextWindow,
        };
    }
    /** Persist a context capacity override or restore provider defaults with null. */
    async updateContextWindow(patch) {
        await this.persist(patch);
        return this.contextWindowSnapshot();
    }
    /** Return the live Fast Mode default shared by all sessions. */
    fastModeSnapshot() {
        return {
            fastModeDefault: this.current.fastModeDefault,
        };
    }
    /** Persist the Fast Mode default toggle. */
    async updateFastMode(patch) {
        await this.persist(patch);
        return this.fastModeSnapshot();
    }
    /** Return the live provider proxy mode and explicit URL. */
    proxySnapshot() {
        return {
            proxyMode: this.current.proxyMode,
            proxyUrl: this.current.proxyUrl,
        };
    }
    /** Observe proxy changes so the transport can reconcile global mode. */
    watchProxyPreferences(listener) {
        this.proxyWatchers.add(listener);
        return () => {
            this.proxyWatchers.delete(listener);
        };
    }
    /** Persist a validated proxy mode or URL. */
    async updateProxy(patch) {
        const normalized = patch.proxyUrl === undefined
            ? patch
            : { ...patch, proxyUrl: normalizeProxyUrl(patch.proxyUrl) };
        await this.persist(normalized);
        return this.proxySnapshot();
    }
    /** Return available models and the live discovery subset for the browser. */
    modelCatalogSnapshot() {
        return {
            availableModels: this.catalogEntries.map((model) => ({
                ...model,
                supportsImages: this.current.imageModels.includes(model.id),
            })),
            models: [...this.current.models],
            imageModels: [...this.current.imageModels],
        };
    }
    /**
     * Replace the advertised catalog after a live listing. Keeps the user's
     * enable / image choices and auto-enables newly discovered ids.
     */
    adoptCatalog(next) {
        const enabled = mergeEnabledModelIds({ catalogModels: this.catalogEntries, enabledModelIds: this.current.models }, next);
        const image = mergeImageModelIds({ catalogModels: this.catalogEntries, imageModelIds: this.current.imageModels }, next);
        this.catalogEntries = next.map((model) => ({ ...model }));
        this.current = {
            ...this.current,
            models: this.normalizeModels(enabled),
            imageModels: this.normalizeImageModels(image),
        };
        // Persist the narrowed selection without blocking the catalog swap: the
        // live policy is already correct for this process, and a failed write must
        // not take the model picker down with it.
        void this.persist({
            models: this.current.models,
            imageModels: this.current.imageModels,
        }).catch((error) => {
            this.warn(`OpenAI Codex catalog preferences could not be saved: ${error instanceof Error ? error.message : String(error)}`);
        });
        return this.modelCatalogSnapshot();
    }
    /** Persist the model subset advertised by this provider. */
    async updateModelCatalog(patch) {
        if (patch.models === undefined && patch.imageModels === undefined) {
            return this.modelCatalogSnapshot();
        }
        const next = {
            ...this.current,
            ...(patch.models === undefined
                ? {}
                : { models: this.normalizeModels(patch.models) }),
            ...(patch.imageModels === undefined
                ? {}
                : { imageModels: this.normalizeImageModels(patch.imageModels) }),
        };
        await this.persist({
            ...(patch.models === undefined ? {} : { models: next.models }),
            ...(patch.imageModels === undefined ? {} : { imageModels: next.imageModels }),
        });
        return this.modelCatalogSnapshot();
    }
    /** Enforce imagegen's cross-provider toggle at execution time. */
    assertAllowed(exec, tool) {
        const configured = exec.agent?.session.requestHeader()?.config;
        const provider = configured?.provider ?? exec.agent?.options.provider;
        if (provider === OPENAI_CODEX_PROVIDER)
            return;
        if (!this.current.shareImagegenWithOtherModels) {
            throw new Error(`${tool} is disabled for models outside the openai-codex provider in Settings`);
        }
    }
    replace(next) {
        next =
            next.useStatefulResponses && !next.useWebSocketContextReuse
                ? { ...next, useWebSocketContextReuse: true }
                : next;
        next = {
            ...next,
            models: this.normalizeModels(next.models),
            imageModels: this.normalizeImageModels(next.imageModels ?? []),
        };
        const imageChanged = next.modifyReadImage !== this.current.modifyReadImage ||
            next.shareImagegenWithOtherModels !==
                this.current.shareImagegenWithOtherModels;
        const proxyChanged = next.proxyMode !== this.current.proxyMode ||
            next.proxyUrl !== this.current.proxyUrl;
        this.current = next;
        if (imageChanged) {
            for (const listener of this.imageWatchers)
                listener();
        }
        if (proxyChanged) {
            for (const listener of this.proxyWatchers)
                listener();
        }
    }
    normalizeModels(models) {
        const selected = new Set(models);
        return this.catalogEntries
            .filter((model) => selected.has(model.id))
            .map((model) => model.id);
    }
    normalizeImageModels(models) {
        const selected = new Set(models);
        return this.catalogEntries
            .filter((model) => selected.has(model.id))
            .map((model) => model.id);
    }
}
//# sourceMappingURL=tool-policy.js.map