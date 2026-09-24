/**
 * WorkBuddy 5.6 at-rest credential protection.
 *
 * Desktop `workbuddy-desktop.info` stores `auth.accessToken` / `refreshToken`
 * as `{$wbEncrypted:1, envelope}` AES-256-GCM wrappers. The protector key
 * comes from WorkBuddy's Electron `workbuddyStorage.loggerGet()`, reached by
 * spawning *that* binary with `ELECTRON_RUN_AS_NODE=1`.
 *
 * Transcribed from dsh-workbuddy-connect's desktop-credential-protection
 * (corrinehu, WorkBuddy 5.6.2). No token or key material is logged.
 */
/** Why a 5.6 credential could not be opened. */
export type WorkBuddySignedOutReasonCode = 'no-credential' | 'encrypted-credential-unreadable' | 'electron-path-invalid' | 'electron-binary-unavailable' | 'electron-binary-not-found' | 'credential-region-mismatch';
/** Env override for the WorkBuddy Electron / WorkBuddy.exe binary. */
export declare const WORKBUDDY_ELECTRON_BIN_ENV = "WORKBUDDY_ELECTRON_BIN";
declare const AUTH_FIELDS: readonly ["accessToken", "refreshToken"];
/** One decoded field envelope. */
export interface WorkBuddyEnvelope {
    suite: number;
    keyId: string;
    nonce: Buffer;
    authTag: Buffer;
    ciphertext: Buffer;
}
/** One wrapped token field. */
export interface WrappedAuthField {
    field: (typeof AUTH_FIELDS)[number];
    envelope: WorkBuddyEnvelope;
}
/** Classification of a desktop auth document. */
export type DesktopAuthClassification = {
    format: 'absent';
} | {
    format: 'plaintext';
} | {
    format: 'encrypted';
    wrapped: {
        document: Record<string, unknown>;
        fields: readonly WrappedAuthField[];
    };
} | {
    format: 'unrecognized';
};
/** Diagnosable helper / decrypt failure. */
export declare class WorkBuddyElectronPathError extends Error {
    readonly reasonCode: WorkBuddySignedOutReasonCode;
    constructor(reasonCode: WorkBuddySignedOutReasonCode, message: string);
}
/** Read the reason code off a thrown value. */
export declare function reasonCodeOf(error: unknown): WorkBuddySignedOutReasonCode | undefined;
/** Distinct envelope key ids, in field order. */
export declare function keyIdsOf(fields: readonly WrappedAuthField[]): string[];
/** Classify a desktop auth document. */
export declare function classifyDesktopAuthDocument(text: string): DesktopAuthClassification;
/** Replace wrapped fields with plaintext so the regular parser can run. */
export declare function unwrapDesktopAuthDocument(classification: Extract<DesktopAuthClassification, {
    format: 'encrypted';
}>, openField: (wrapped: WrappedAuthField) => string): string;
/** AAD transcribed from WorkBuddy 5.6.2 `buildAuthenticatedContextAad`. */
export declare function buildAuthenticatedContextAad(keyId: string, suite: number): Buffer;
/** Open one envelope; `undefined` when the key or format is wrong. */
export declare function openAuthField(key: Buffer, envelope: WorkBuddyEnvelope): string | undefined;
/** Test helper: seal a field in the 5.6 on-disk shape. */
export declare function sealAuthFieldForTest(key: Buffer, plaintext: string, suite?: number): {
    $wbEncrypted: 1;
    envelope: string;
};
/** `{version:1, atRestSecretKey}` from the Electron helper. */
export interface WorkBuddyAtRestPayload {
    atRestSecretKey: string;
}
/** Validate the helper payload. */
export declare function parseAtRestPayload(text: string): WorkBuddyAtRestPayload | undefined;
/** Protector key = sha256(utf8 secret). */
export declare function deriveProtectorKey(secret: string): Buffer;
/** Pick WorkBuddy.exe out of `reg query` text; never the uninstaller. */
export declare function pickWorkBuddyExeFromRegistry(stdout: string): string | undefined;
/** Electron / WorkBuddy.exe this machine should spawn for the key helper. */
export declare function resolveWorkBuddyElectronPath(): string | undefined;
/** In-memory protector-key resolver: one spawn per process, never persisted. */
export declare class WorkBuddyAtRestKeyProvider {
    private cache;
    private inflight;
    private readonly timeoutMs;
    private readonly electronPathOverride;
    constructor(options?: {
        electronPath?: string;
        timeoutMs?: number;
    });
    /** Binary that would be spawned; diagnostics only. */
    helperPath(): string | undefined;
    /** Protector key matching one of the envelope ids. */
    protectorKeyFor(requested: readonly string[]): Promise<Buffer>;
    private ingest;
    private spawnPayload;
}
export {};
