/**
 * Owner-only persistent OAuth credential storage for the OpenAI Codex bundle.
 * @module dsh-codex/store
 */
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';
/** Provider route and pi-ai provider id owned by this bundle. */
export declare const OPENAI_CODEX_PROVIDER = "openai-codex";
/** Basename of the OAuth document inside the Harness home. */
export declare const OPENAI_CODEX_AUTH_FILENAME = ".openai-codex-auth.json";
/**
 * Resolve the default OAuth document path.
 * @param dshHome - optional Harness-home override.
 * @returns the absolute owner-only document path.
 */
export declare function openAICodexAuthPath(dshHome?: string): string;
/** File-backed pi-ai store scoped to the single OpenAI Codex provider. */
export declare class OpenAICodexCredentialStore implements CredentialStore {
    /** Absolute credential document path. */
    readonly filename: string;
    /**
     * @param filename - explicit document path, defaulting under `$DSH_HOME`.
     */
    constructor(filename?: string);
    /** Read and validate the current document without acquiring the writer lock. */
    private readCurrent;
    /** @inheritdoc */
    read(providerId: string): Promise<Credential | undefined>;
    /** @inheritdoc */
    list(): Promise<readonly CredentialInfo[]>;
    /** @inheritdoc */
    modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
    /** @inheritdoc */
    delete(providerId: string): Promise<void>;
}
