/** Process-local, per-session OpenAI Codex Fast Mode state. */
/** Maximum number of enabled sessions retained by one plugin instance. */
export declare const OPENAI_CODEX_FAST_MODE_MAX_SESSIONS = 256;
/** Maximum UTF-16 code units accepted for an opaque DSH session id. */
export declare const OPENAI_CODEX_FAST_MODE_MAX_SESSION_ID_LENGTH = 256;
/**
 * Validate the opaque session identity used by the Fast Mode registry.
 *
 * The registry deliberately does not interpret or normalize session ids.  It
 * only rejects values that cannot safely serve as a bounded map key.
 */
export declare function isFastModeSessionId(value: unknown): value is string;
/**
 * In-memory Fast Mode registry.  Entries are positive-only: disabling a
 * session removes its key, and an insertion over the bound evicts the least
 * recently touched key.  A new plugin instance starts with an empty map.
 */
export declare class FastModeRegistry {
    private readonly maxSessions;
    private readonly enabledSessions;
    constructor(maxSessions?: number);
    /** Number of currently enabled sessions. */
    get size(): number;
    /** Read one session without exposing the map or any credential state. */
    isEnabled(sessionId: unknown): boolean;
    /** Alias useful to callers that model this as a boolean setting. */
    get(sessionId: unknown): boolean;
    /** Enable or disable exactly one opaque session id. */
    set(sessionId: unknown, enabled: boolean): void;
    /** Explicitly named alias for callers that avoid boolean-setting verbs. */
    setEnabled(sessionId: unknown, enabled: boolean): void;
    /** Disable one session and forget its key. */
    delete(sessionId: unknown): void;
    /** Remove all process-local state during an explicit lifecycle teardown. */
    clear(): void;
}
/** Descriptive alias retained for integrations that namespace plugin state. */
export { FastModeRegistry as OpenAICodexFastModeRegistry };
