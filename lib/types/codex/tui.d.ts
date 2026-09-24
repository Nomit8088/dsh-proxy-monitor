/** Optional dsh-tui front-door adapter for account and live preference commands. */
import type { Context } from "@deepseek-ai/cordis";
declare module "@deepseek-ai/cordis" {
    interface Context {
        /** Empty marker published while the Codex terminal adapter is active. */
        openAICodexTui: object;
    }
}
export declare const name = "dsh-codex-tui";
export declare const inject: string[];
/** Register executable commands independently from any concrete UI frontend. */
export declare function apply(ctx: Context): void;
export default apply;
