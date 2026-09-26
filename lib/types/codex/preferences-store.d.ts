/**
 * File-backed OpenAI Codex preference document.
 *
 * The bundled Codex tree used to persist these values through a settings
 * namespace (`openai-codex`). DSH 0.1.7 removed plugin-declared namespaces —
 * the seam now projects a plugin entry's own `.volatile()` Config fields, keyed
 * by entry id — and these preferences could not live in that entry's Config
 * even if they wanted to: the schema depends on the *live* model catalog (the
 * enabled and vision defaults are whatever the provider just advertised), which
 * a fixed profile schema cannot express, and the credential sweep rewrites the
 * selection on every live listing, which against the entry Config would mean a
 * profile-patch write per sweep.
 *
 * They therefore live in their own document under the Harness home, beside the
 * Grok catalog preferences, with the same write discipline (temp file +
 * rename, serialized read-modify-write) and no process-lifetime cache that a
 * hot reload could strand.
 *
 * @module @dsh-external/dsh-proxy-monitor/codex/preferences-store
 */
/** One stored preference document: the raw user layer plus provenance. */
export interface OpenAICodexPreferenceDocument {
    /**
     * Stored values, exactly the keys a writer supplied. Merged over the schema
     * defaults and the composition base when it is resolved, never in place of
     * them, so a missing key means "inherit" rather than "erase".
     */
    values: Record<string, unknown>;
    /** Epoch milliseconds of the last accepted write; 0 before any. */
    updatedAt: number;
}
/** File-backed Codex preferences; one instance per Host plugin fiber. */
export declare class OpenAICodexPreferenceStore {
    /** Absolute path this store reads and writes. */
    readonly path: string;
    private cache;
    /** Serialized read-modify-write chain, so two writers cannot interleave. */
    private chain;
    constructor(file?: string);
    /** Last read or written document; an empty one before the first read. */
    snapshot(): OpenAICodexPreferenceDocument;
    /**
     * Read the document, treating an absent file as an empty one.
     * @returns the parsed document.
     */
    read(): Promise<OpenAICodexPreferenceDocument>;
    /**
     * Replace the stored user layer.
     * @param values - the complete next user layer.
     * @returns the written document.
     */
    write(values: Record<string, unknown>): Promise<OpenAICodexPreferenceDocument>;
    /**
     * Apply one edit to the current user layer under the write chain.
     * @param fn - receives the current document, returns the next user layer.
     * @returns the written document.
     */
    modify(fn: (current: OpenAICodexPreferenceDocument) => Record<string, unknown> | Promise<Record<string, unknown>>): Promise<OpenAICodexPreferenceDocument>;
}
