/**
 * dsh-proxy-monitor, host half.
 *
 * Mounts three things on the Host plane:
 *
 * 1. the `dsh-proxy-monitor` settings namespace, so the plugin's own options
 *    (which providers to show, where the rail sits, how often to poll) live in
 *    the user settings document beside every other plugin's;
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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "@dsh-external/dsh-proxy-monitor";
/**
 * Required Host services: provider configuration, the browser transport, and
 * the LLM registry.
 *
 * `llm` is not optional here even though most of this plugin reaches the
 * registry through a nested `ctx.inject(['llm'], …)`: the WorkBuddy runtime is
 * vendored whole and touches `ctx.llm` directly, so the *plugin's* inject list
 * is what decides whether its route may register at all. Omitting it made cordis
 * refuse the property access ("cannot get property \"llm\" without inject"),
 * which the vendored code catches and logs — leaving WorkBuddy selectable in
 * settings and absent from the composer's model picker.
 */
export declare const inject: string[];
/**
 * Plugin configuration. Every field has a default, so a bare `insert` row
 * mounts the plugin with no config at all.
 */
export interface Config {
    /** Whether the floating rail is shown at all. */
    enabled: boolean;
    /** Providers to show, in the order given; others are read but not rendered. */
    providers: string[];
    /** Where the rail sits against the viewport edge. */
    anchor: 'right' | 'left';
    /** Vertical placement of the rail. */
    align: 'center' | 'top' | 'bottom';
    /** Opacity of the rail when the pointer is away from it. */
    restingOpacity: number;
    /** Whether the ring shows the numeric percentage under it. */
    showPercent: boolean;
    /** Whether a ring may be expanded by hovering, or only by clicking. */
    expandOnHover: boolean;
    /** How long a snapshot stays fresh before a background re-read, in seconds. */
    refreshSeconds: number;
    /** Order the rows by name instead of by the configured `providers` order. */
    sortAlphabetically: boolean;
    /**
     * Whether the rail may shift DSH's own turn navigator aside when the two
     * would overlap. Only ever moves that navigator left by the overlap.
     */
    yieldToTurnNav: boolean;
}
export declare const Config: z<Config>;
/**
 * Mount the collector, its settings namespace, and the browser transport.
 * @param ctx - host plugin context.
 * @param config - composed configuration (schema defaults, then user layer).
 */
export declare function apply(ctx: Context, config: Config): void;
