/** Secret-free diagnostics and duplicate-provider guidance. */
import { type CompatibilityDetectionOptions, type CompatibilityReport } from './compatibility.js';
export { CODEX_CONNECT_VERSION } from './version.js';
/** Inputs that are safe to obtain without booting OAuth. */
export interface OpenAICodexDiagnosticOptions {
    /** Credential pathname to inspect through metadata only. */
    credentialPath?: string;
    /** Provider ids already registered in the active Harness context. */
    providerIds?: readonly string[];
    /** Whether the optional standalone search provider is enabled. */
    enableSearch?: boolean;
    /** Whether the optional image tool is enabled. */
    enableImageTool?: boolean;
    /** Optional pure-function seam for compatibility checks in tests/diagnostic callers. */
    compatibilityOptions?: CompatibilityDetectionOptions;
}
export interface OpenAICodexDiagnosticReport {
    package: 'dsh-codex';
    version: string;
    node: string;
    credentialFile: {
        path: string;
        state: 'missing' | 'owner-only' | 'permissions-too-broad' | 'not-a-regular-file' | 'unreadable-metadata';
        mode?: string;
    };
    capabilities: {
        modelProvider: true;
        search: boolean;
        imageTool: boolean;
        changesHarnessDefaultModel: true;
        changesHarnessSearchRoute: true;
    };
    providerConflict: boolean;
    compatibility: CompatibilityReport;
    hints: string[];
}
/** Actionable message for legacy/manual `openai-codex` adapter collisions. */
export declare function openAICodexConflictMessage(): string;
/** Fail before the generic registry error so the collision has a migration hint. */
export declare function assertNoOpenAICodexProviderConflict(providerIds: readonly string[]): void;
/**
 * Inspect only process and filesystem metadata. This function never opens the
 * OAuth document, refreshes a token, or starts an authorization flow.
 */
export declare function diagnoseOpenAICodex(options?: OpenAICodexDiagnosticOptions): Promise<OpenAICodexDiagnosticReport>;
