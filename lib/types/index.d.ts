/**
 * dsh-proxy-monitor, host half.
 *
 * Mounts three things on the Host plane:
 *
 * 1. the plugin's own options (which providers to show, where the rail sits,
 *    how often to poll) as `.volatile()` fields of this plugin's Config. Since
 *    DSH 0.1.7 the settings seam projects a plugin entry's volatile fields into
 *    that entry's config form, so a write from the settings page lands in the
 *    profile patch and the Loader commits the new values into these same
 *    references — `loader/volatile-update` — without remounting the plugin;
 * 2. the quota collector, which reads each provider's own credential source
 *    and quota endpoint;
 * 3. a plugin-owned Connection RPC channel, the only transport by which quota
 *    numbers — never credentials — reach the browser.
 *
 * Nothing here touches the LLM routes, the tool registry, or the session
 * lifecycle, so the plugin cannot perturb the agent's behaviour.
 *
 * @module @dsh-external/dsh-proxy-monitor
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { Config as WorkBuddyConfigSchema, type Config as WorkBuddySection } from './workbuddy/index.js';
export declare const name = "@dsh-external/dsh-proxy-monitor";
/**
 * Required Host services: the LLM registry.
 *
 * `llm` is not optional here even though most of this plugin reaches the
 * registry through a nested `ctx.inject(['llm'], …)`: the WorkBuddy runtime is
 * vendored whole and touches `ctx.llm` directly, so the *plugin's* inject list
 * is what decides whether its route may register at all. Omitting it made cordis
 * refuse the property access ("cannot get property \"llm\" without inject"),
 * which the vendored code catches and logs — leaving WorkBuddy selectable in
 * settings and absent from the composer's model picker.
 *
 * Neither `settings` nor `connection` is required:
 *
 * - `settings` no longer holds a plugin's configuration (0.1.7 projects the
 *   entry's own volatile Config), so a deployment without the seam must still
 *   get the rail, the collector, and the providers;
 * - `connection` is the browser transport, and only the plugin-owned RPC
 *   channel needs it. Requiring it kept the whole entry `pending (waiting for
 *   service: connection)` in every profile with no Web surface — a headless or
 *   TUI run would mount no collector at all.
 *
 * Both are therefore reached through optional `ctx.inject` children below.
 */
export declare const inject: string[];
/**
 * Plugin configuration.
 *
 * Every editable field is `.volatile()`, which is exactly what makes it visible
 * to the settings seam: `dsh-settings` projects an entry's volatile fields into
 * that entry's form, and the Loader keeps those same references live by writing
 * committed values into them. A field left non-volatile would be ordinary
 * composition configuration, editable only by hand in the profile patch.
 *
 * Declared as an interface of `Volatile<T>` fields beside the schema itself
 * (the pattern the shipped plugins use): the schema is what the Loader reads,
 * the interface is what `apply` receives.
 */
export interface Config {
    /** Whether the floating rail is shown at all. */
    enabled: Volatile<boolean>;
    /** Providers to show, in the order given; others are read but not rendered. */
    providers: Volatile<string[]>;
    /** Where the rail sits against the viewport edge. */
    anchor: Volatile<'right' | 'left'>;
    /** Vertical placement of the rail. */
    align: Volatile<'center' | 'top' | 'bottom'>;
    /** Opacity of the rail when the pointer is away from it. */
    restingOpacity: Volatile<number>;
    /** Whether the ring shows the numeric percentage under it. */
    showPercent: Volatile<boolean>;
    /** Whether a ring may be expanded by hovering, or only by clicking. */
    expandOnHover: Volatile<boolean>;
    /** How long a snapshot stays fresh before a background re-read, in seconds. */
    refreshSeconds: Volatile<number>;
    /** Order the rows by name instead of by the configured `providers` order. */
    sortAlphabetically: Volatile<boolean>;
    /**
     * Whether the rail may shift DSH's own turn navigator aside when the two
     * would overlap. Only ever moves that navigator left by the overlap.
     */
    yieldToTurnNav: Volatile<boolean>;
    /**
     * The vendored WorkBuddy runtime's own fields, nested under this entry so a
     * single configuration surface owns them and the configurable-provider
     * directory can point at `workbuddy` inside this entry.
     */
    workbuddy: Volatile<WorkBuddySection>;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    enabled: z<boolean, boolean, "volatile-defined">;
    providers: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    anchor: z<"right" | "left", "right" | "left", "volatile-defined">;
    align: z<"center" | "top" | "bottom", "center" | "top" | "bottom", "volatile-defined">;
    restingOpacity: z<number, number, "volatile-defined">;
    showPercent: z<boolean, boolean, "volatile-defined">;
    expandOnHover: z<boolean, boolean, "volatile-defined">;
    refreshSeconds: z<number, number, "volatile-defined">;
    sortAlphabetically: z<boolean, boolean, "volatile-defined">;
    yieldToTurnNav: z<boolean, boolean, "volatile-defined">;
    workbuddy: z<NoInfer<WorkBuddyConfigSchema>, NoInfer<WorkBuddyConfigSchema>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: z<boolean, boolean, "volatile-defined">;
    providers: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    anchor: z<"right" | "left", "right" | "left", "volatile-defined">;
    align: z<"center" | "top" | "bottom", "center" | "top" | "bottom", "volatile-defined">;
    restingOpacity: z<number, number, "volatile-defined">;
    showPercent: z<boolean, boolean, "volatile-defined">;
    expandOnHover: z<boolean, boolean, "volatile-defined">;
    refreshSeconds: z<number, number, "volatile-defined">;
    sortAlphabetically: z<boolean, boolean, "volatile-defined">;
    yieldToTurnNav: z<boolean, boolean, "volatile-defined">;
    workbuddy: z<NoInfer<WorkBuddyConfigSchema>, NoInfer<WorkBuddyConfigSchema>, "volatile-defined">;
}>>, "plain">;
/**
 * Mount the collector, the configuration surface, and the browser transport.
 * @param ctx - host plugin context.
 * @param config - the live configuration references the Loader keeps updated.
 */
export declare function apply(ctx: Context, config: Config): void;
