/**
 * Setup outcomes for the reverse-proxy providers, for the diagnostics surface.
 *
 * The settings page can show a provider even when its LLM route never came up:
 * the configurable-provider *directory* feeds the settings UI, while the
 * *adapter* is what the conversation's model picker reads. So "WorkBuddy is in
 * the settings page but absent from the picker" is a state that no existing
 * surface reports — the failing registration is swallowed by the vendored
 * runtime, which logs and returns `false`.
 *
 * This registry is that missing report: each provider's setup records one
 * outcome per phase, and `GET /plugins/dsh-proxy-monitor/picker/models` serves
 * them next to the picker's own answer.
 *
 * @module @dsh-external/dsh-proxy-monitor/diagnostics
 */
/** Which step of a provider's startup an outcome describes. */
export type SetupPhase = 'apply' | 'route';
/** One provider's setup result, kept for the life of the process. */
export interface SetupOutcome {
    /** LLM route id, e.g. `workbuddy`. */
    provider: string;
    /** The step: the vendored `apply()` call, or the LLM route registration. */
    phase: SetupPhase;
    /** Whether the step completed. */
    ok: boolean;
    /** Why it failed, when it did. */
    error?: string;
    /** A non-fatal observation worth showing (e.g. a tolerated duplicate). */
    note?: string;
}
/**
 * Record (or replace) one provider's outcome for one phase.
 *
 * Replacement rather than append: this is current state, not a log, and a hot
 * reload legitimately revisits the same phase. A note already recorded for the
 * phase survives a later note-less success, so a tolerated duplicate stays
 * visible after the step that follows it reports plain success.
 *
 * @param outcome - the result to remember.
 */
export declare function recordSetupOutcome(outcome: SetupOutcome): void;
/**
 * Snapshot the recorded outcomes.
 * @returns a detached copy, oldest first.
 */
export declare function setupOutcomes(): readonly SetupOutcome[];
/** Normalize an unknown thrown value into the one-line reason we display. */
export declare function reasonText(error: unknown): string;
