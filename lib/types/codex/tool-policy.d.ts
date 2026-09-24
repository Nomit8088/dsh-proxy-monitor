import type { Context } from "@deepseek-ai/cordis";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { ProxyPreferences } from "./proxy.js";
/** User-controlled image-tool integration. */
export interface ImageToolPreferences {
    modifyReadImage: boolean;
    shareImagegenWithOtherModels: boolean;
}
/** Experimental request behavior used only by the OpenAI Codex adapter. */
export interface ResponseApiPreferences {
    useWebSocketContextReuse: boolean;
    useNativeCompaction: boolean;
}
/** Client-side capacity override applied to OpenAI Codex models. */
export interface ContextWindowPreferences {
    /** Tokens advertised to dsh, or null to keep each provider catalog default. */
    contextWindow: number | null;
    /** Whether the global override also applies to GPT-5.3 Codex Spark. */
    overrideSparkContextWindow: boolean;
}
/** One selectable model from the complete provider catalog. */
export interface ModelCatalogEntry {
    id: string;
    name: string;
    contextWindow: number;
    /** Inferred from the provider catalog; user overlay lives in `imageModels`. */
    supportsImages: boolean;
}
/** Live subset advertised through dsh model discovery. */
export interface ModelCatalogPreferences {
    models: string[];
    /** Models that declare image input so DSH will not intercept attachments. */
    imageModels: string[];
}
/** Fast Mode behavior applied to every Codex session. */
export interface FastModePreferences {
    /** Force the priority service tier on all sessions without the per-session toggle. */
    fastModeDefault: boolean;
}
/** Browser projection containing both available and currently visible models. */
export interface ModelCatalogSettings extends ModelCatalogPreferences {
    availableModels: ModelCatalogEntry[];
}
interface OpenAICodexPreferences extends ImageToolPreferences, ResponseApiPreferences, ModelCatalogPreferences, ContextWindowPreferences, FastModePreferences, ProxyPreferences {
    /** Migration-only key written by the unreleased store:true experiment. */
    useStatefulResponses: boolean;
}
/** Defaults keep generic vision-model interoperability enabled. */
export declare const DEFAULT_IMAGE_TOOL_PREFERENCES: ImageToolPreferences;
/** Conservative defaults preserve the established stateless Harness behavior. */
export declare const DEFAULT_RESPONSE_API_PREFERENCES: ResponseApiPreferences;
/** Keep provider-declared capacities until the owner opts into an override. */
export declare const DEFAULT_CONTEXT_WINDOW_PREFERENCES: ContextWindowPreferences;
/** Keep Fast Mode a per-session opt-in until the owner forces it globally. */
export declare const DEFAULT_FAST_MODE_PREFERENCES: FastModePreferences;
/** Live policy shared by the host tools, Codex adapter, and settings HTTP surface. */
export declare class ImageToolPolicy {
    private current;
    private scope;
    private readonly imageWatchers;
    private readonly proxyWatchers;
    private catalogEntries;
    constructor(base?: Partial<OpenAICodexPreferences>, modelCatalog?: readonly ModelCatalogEntry[]);
    /** Register durable live settings when the active profile supplies ctx.settings. */
    attach(ctx: Context): void;
    /** Return a detached settings projection for the browser. */
    snapshot(): ImageToolPreferences;
    /** Observe live changes that add or remove the scoped `read_image` enhancement. */
    watchImagePreferences(listener: () => void): () => void;
    /** Persist a partial browser update through the settings service. */
    update(patch: Partial<ImageToolPreferences>): Promise<ImageToolPreferences>;
    /** Return the current Codex-only Responses API experiments. */
    responseApiSnapshot(): ResponseApiPreferences;
    /** Persist a partial Responses API experiment update. */
    updateResponseApi(patch: Partial<ResponseApiPreferences>): Promise<ResponseApiPreferences>;
    /** Return the live client-side context capacity override. */
    contextWindowSnapshot(): ContextWindowPreferences;
    /** Persist a context capacity override or restore provider defaults with null. */
    updateContextWindow(patch: Partial<ContextWindowPreferences>): Promise<ContextWindowPreferences>;
    /** Return the live Fast Mode default shared by all sessions. */
    fastModeSnapshot(): FastModePreferences;
    /** Persist the Fast Mode default toggle. */
    updateFastMode(patch: Partial<FastModePreferences>): Promise<FastModePreferences>;
    /** Return the live provider proxy mode and explicit URL. */
    proxySnapshot(): ProxyPreferences;
    /** Observe proxy changes so the transport can reconcile global mode. */
    watchProxyPreferences(listener: () => void): () => void;
    /** Persist a validated proxy mode or URL. */
    updateProxy(patch: Partial<ProxyPreferences>): Promise<ProxyPreferences>;
    /** Return available models and the live discovery subset for the browser. */
    modelCatalogSnapshot(): ModelCatalogSettings;
    /**
     * Replace the advertised catalog after a live listing. Keeps the user's
     * enable / image choices and auto-enables newly discovered ids.
     */
    adoptCatalog(next: readonly ModelCatalogEntry[]): ModelCatalogSettings;
    /** Persist the model subset advertised by this provider. */
    updateModelCatalog(patch: Partial<ModelCatalogPreferences>): Promise<ModelCatalogSettings>;
    /** Enforce imagegen's cross-provider toggle at execution time. */
    assertAllowed(exec: ToolExecution, tool: "imagegen"): void;
    private replace;
    private normalizeModels;
    private normalizeImageModels;
}
export {};
