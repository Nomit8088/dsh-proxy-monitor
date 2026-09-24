/**
 * Plugin-owned model-catalog HTTP surfaces that do not share paths with the
 * leftover standalone bundles (dsh-codex / dsh-workbuddy-connect).
 *
 * Those bundles still occupy `/plugins/dsh-openai-codex/models` and never
 * registered `/plugins/dsh-workbuddy-connect/models`, so this plugin must
 * serve its own URLs or the settings UI 404/405s.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const WORKBUDDY_MODELS_API = "/plugins/dsh-proxy-monitor/workbuddy/models";
export declare const CODEX_MODELS_API = "/plugins/dsh-proxy-monitor/codex/models";
/**
 * The picker's own view, for diagnosis.
 *
 * `docs/MODEL_CATALOG.md` §1 splits "the catalog an operator edits" from "the
 * catalog the picker reads", and only the second one decides what a user can
 * select. They are answered by different code, so a disagreement is invisible
 * from the settings page alone. This route asks the LLM registry the same
 * question the picker asks, which turns that whole class of bug into one GET.
 */
export declare const PICKER_MODELS_API = "/plugins/dsh-proxy-monitor/picker/models";
/**
 * Basename of the WorkBuddy enable/image preferences.
 *
 * ONE file, because two would drift: the vendored WorkBuddy runtime
 * (`src/workbuddy/index.js`) reads this name from the DSH home for its own
 * `listModels` filter, and the operator's settings page writes whatever the
 * route that answers implements. When the two named different files, a
 * selection landed in one and the picker filtered by the other — which is
 * exactly the "I enabled a model and it never appeared" report. The vendored
 * constant `WORKBUDDY_USER_CATALOG_FILENAME` must stay equal to this string
 * (`scripts/test-workbuddy-catalog.mjs` asserts it by reading that source).
 */
export declare const WORKBUDDY_PREFS_FILENAME = ".workbuddy-user-catalog.json";
/** Apply saved enable / image flags onto a leftover WorkBuddy adapter catalog. */
export declare function overlayWorkBuddyAdapterModels<T extends {
    id: string;
    inputModalities?: readonly string[];
}>(models: readonly T[]): Promise<T[]>;
/** Register the WorkBuddy catalog API even when the standalone bundle already applied. */
export declare function registerWorkBuddyCatalogApi(ctx: Context): void;
/**
 * Register a read-only diagnostic that answers what the model picker sees.
 *
 * It calls the same public registry methods the picker calls
 * (`listProviders()` then `listModels(provider)`), so its answer *is* the
 * picker's answer — including the failure rows, which are kept instead of
 * swallowed so "the provider is missing" and "the provider threw" stay
 * distinguishable.
 *
 * @param ctx - host context; needs both `llm` and `webServer`.
 */
export declare function registerPickerModelsApi(ctx: Context): void;
