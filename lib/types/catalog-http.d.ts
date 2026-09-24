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
/** Apply saved enable / image flags onto a leftover WorkBuddy adapter catalog. */
export declare function overlayWorkBuddyAdapterModels<T extends {
    id: string;
    inputModalities?: readonly string[];
}>(models: readonly T[]): Promise<T[]>;
/** Register the WorkBuddy catalog API even when the standalone bundle already applied. */
export declare function registerWorkBuddyCatalogApi(ctx: Context): void;
