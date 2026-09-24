/** Owner-only allowlist for browser origins that may reach the Web OAuth routes. */
/** Basename of the DSH-home-scoped browser-origin allowlist. */
export declare const OPENAI_CODEX_TRUSTED_ORIGINS_FILENAME = ".openai-codex-trusted-origins.json";
/** Current on-disk format. Readers reject every other version. */
export declare const TRUSTED_ORIGINS_FORMAT_VERSION = 1;
/** Only supported policy mode; a future mode must not be silently accepted. */
export declare const TRUSTED_ORIGINS_MODE = "allowlist";
/**
 * Normalize one exact browser origin.
 *
 * Only HTTP(S) origins are accepted. Credentials, non-root paths, queries,
 * fragments, wildcards, and CIDR-looking host paths are rejected. WHATWG URL
 * normalization lowercases the scheme/host and removes default ports.
 */
export declare function normalizeTrustedOrigin(rawOrigin: string): string;
/** Resolve the sidecar path under one DSH home. */
export declare function openAICodexTrustedOriginsPath(dshHome?: string): string;
/** File-backed exact-origin allowlist. */
export declare class OpenAICodexTrustedOriginsStore {
    /** Absolute sidecar path. */
    readonly filename: string;
    constructor(filename?: string);
    private readCurrent;
    /** Read the current canonical list without acquiring the writer lock. */
    list(): Promise<readonly string[]>;
    /** Whether an exact normalized origin is currently trusted. */
    has(origin: string): Promise<boolean>;
    /** Add one origin idempotently and return the resulting sorted list. */
    trust(origin: string): Promise<readonly string[]>;
    /** Remove one origin idempotently and return the resulting sorted list. */
    untrust(origin: string): Promise<readonly string[]>;
}
