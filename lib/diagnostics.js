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
const outcomes = [];
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
export function recordSetupOutcome(outcome) {
    const index = outcomes.findIndex(entry => entry.provider === outcome.provider && entry.phase === outcome.phase);
    if (index === -1) {
        outcomes.push(outcome);
        return;
    }
    const previous = outcomes[index];
    outcomes[index] = {
        ...outcome,
        ...(outcome.note === undefined && previous?.note !== undefined ? { note: previous.note } : {}),
    };
}
/**
 * Snapshot the recorded outcomes.
 * @returns a detached copy, oldest first.
 */
export function setupOutcomes() {
    return [...outcomes];
}
/** Normalize an unknown thrown value into the one-line reason we display. */
export function reasonText(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
//# sourceMappingURL=diagnostics.js.map