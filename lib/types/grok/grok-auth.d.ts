/**
 * Grok CLI login-state access for the DeepSeek Harness: read, refresh, and
 * atomically persist the xAI OAuth token set in the Grok CLI auth file
 * (`~/.grok/auth.json`, or `$GROK_HOME/auth.json` when GROK_HOME is set).
 *
 * The file is the official Grok CLI's own. This module only (a) reads the
 * current access token for a request, (b) refreshes it through the official
 * `auth.x.ai` token endpoint when it is about to expire, writing the result
 * back with the same atomic-write discipline and owner-only permissions the
 * CLI itself uses, and (c) reads status facts for configuration surfaces. No
 * token value is ever logged or emitted by the status path.
 *
 * The auth document is keyed by `<issuer>::<client_id>` (one entry per
 * account/client pair). Field names carry aliases across CLI versions:
 * the access token lives in `key` (current) or `access_token` (documented),
 * the refresh token in `refresh_token` or `refresh`, and the expiry in
 * `expires_at` or `expires`. Reads tolerate every alias; writes update the
 * field the entry already uses so the CLI keeps recognising its own file.
 *
 * @module dsh-grok-auth/grok-auth
 */
/** The public OAuth client id xAI ships for the official Grok CLI's desktop flow. */
export declare const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
/** The OIDC issuer the Grok CLI authenticates against. */
export declare const GROK_OAUTH_ISSUER = "https://auth.x.ai";
/** The OAuth token endpoint used for refresh and device-code polling. */
export declare const GROK_OAUTH_TOKEN_URL = "https://auth.x.ai/oauth2/token";
/** The RFC 8628 device-authorization endpoint. */
export declare const GROK_OAUTH_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
/** Scopes matching the official CLI login: identity, refresh, CLI and API access. */
export declare const GROK_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
/** The auth-document entry key the official Grok CLI writes for this issuer/client pair. */
export declare const GROK_AUTH_ENTRY_KEY = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
/** Default lead time before the access token expires that a refresh is triggered (the CLI's own GROK_AUTH_EARLY_INVALIDATION_SECS default). */
export declare const DEFAULT_REFRESH_LEAD_MS: number;
/** Access-token lifetime assumed when a token reply names none and the JWT is opaque. */
export declare const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
/**
 * One account entry of the Grok CLI auth document; unknown fields (identity
 * facts like `email`, `user_id`, `team_id`, retention flags, …) are preserved.
 */
export interface GrokAuthEntry {
    /** Access token (current CLI field name). */
    key?: string;
    /** Access token (documented alias). */
    access_token?: string;
    refresh_token?: string;
    /** Refresh token alias used by some stores. */
    refresh?: string;
    /** ISO expiry of the access token (current CLI field name). */
    expires_at?: string;
    /** Expiry alias: ISO string or epoch milliseconds. */
    expires?: string | number;
    auth_mode?: string;
    create_time?: string;
    email?: string;
    oidc_issuer?: string;
    oidc_client_id?: string;
    [extra: string]: unknown;
}
/** The Grok auth document: entries keyed by `<issuer>::<client_id>`; unknown entries are preserved. */
export type GrokAuthFile = Record<string, unknown>;
/** Stable identity/freshness facts for the exact auth-file inode that was read. */
export interface GrokAuthFileVersion {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
}
/** Parsed auth state bound to the exact file version its bytes came from. */
export interface GrokAuthSnapshot {
    file: GrokAuthFile;
    version: GrokAuthFileVersion;
}
/** The token endpoint's reply; `expires_in` is carried so expiry can be recorded. */
export interface GrokTokenReply {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
}
/** One auth file plus its decoded access-token facts. */
export interface GrokAuthState {
    file: GrokAuthFile | undefined;
    /** The selected account entry, when one exists. */
    entry: GrokAuthEntry | undefined;
    /** The selected entry's document key, when one exists. */
    entryKey: string | undefined;
    /** The current access token, when present. */
    accessToken: string | undefined;
    /** The access token's expiry in epoch milliseconds, when determinable. */
    accessTokenExpiresAt: number | undefined;
}
/** One RFC 8628 device-authorization grant awaiting user approval. */
export interface GrokDeviceAuthorization {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    intervalSeconds?: number;
    expiresInSeconds: number;
}
/** One device-token polling step outcome. */
export type GrokDevicePollResult = {
    status: 'complete';
    reply: GrokTokenReply;
} | {
    status: 'pending';
} | {
    status: 'slow_down';
    intervalSeconds?: number;
} | {
    status: 'failed';
    message: string;
};
/** The auth file path for the current environment (GROK_HOME overrides ~/.grok). */
export declare function defaultAuthJsonPath(env?: NodeJS.ProcessEnv): string;
/**
 * The lock target serializing DSH-side writers of one auth file. The official
 * grok CLI keeps a persistent `auth.json.lock` of its own (a `pid:epoch`
 * record it never removes), so locking the auth path directly through
 * `withFileLock` would contend forever against a file that is not a
 * dsh-atomic-write lock. DSH processes therefore serialize on a plugin-owned
 * sibling (`auth.json.dsh.lock`); the CLI does not participate, matching the
 * fail-closed-recovery guarantee rather than absolute cross-client
 * serialization.
 */
export declare function dshLockTargetFor(authJsonPath: string): string;
/**
 * Decode the JWT payload of a Grok access token without verifying it. The
 * `exp` claim is the expiry fallback when the document names none; `email` is
 * absent from access tokens, so identity facts stay entry-owned.
 */
export declare function decodeAccessToken(token: string): {
    expSeconds?: number;
};
/**
 * Read and parse the Grok auth file. Absence answers `undefined`; a malformed
 * document throws — a file that exists but cannot be trusted must never read
 * as "no login" on the settings page.
 */
export declare function readAuthFile(path: string): Promise<GrokAuthFile | undefined>;
/**
 * Read auth bytes and version facts from one open file descriptor. Atomic
 * replacement after the open leaves this snapshot bound to the old inode, so
 * a later path stat reliably invalidates it instead of pairing old bytes with
 * a new file's timestamp.
 */
export declare function readAuthSnapshot(path: string): Promise<GrokAuthSnapshot | undefined>;
/** Read only the current path version for a cheap credential-cache check. */
export declare function readAuthFileVersion(path: string): Promise<GrokAuthFileVersion | undefined>;
/** Exact equality for the inode and freshness fields used by the auth cache. */
export declare function sameAuthFileVersion(left: GrokAuthFileVersion, right: GrokAuthFileVersion): boolean;
/**
 * Select the account entry this plugin coordinates. Preference order: the
 * exact `<issuer>::<client_id>` key the official CLI writes, any entry keyed
 * for the same client id, any entry claiming the same `oidc_client_id`, then
 * a lone entry of any key — so a renamed or older store still resolves.
 */
export declare function selectAuthEntry(file: GrokAuthFile | undefined): {
    entryKey: string;
    entry: GrokAuthEntry;
} | undefined;
/** The entry's access token across field aliases, when present and non-empty. */
export declare function accessTokenOf(entry: GrokAuthEntry | undefined): string | undefined;
/** The entry's refresh token across field aliases, when present and non-empty. */
export declare function refreshTokenOf(entry: GrokAuthEntry | undefined): string | undefined;
/**
 * The access token's expiry in epoch milliseconds: the entry's recorded
 * `expires_at`/`expires` when parseable, else the JWT `exp` claim.
 */
export declare function expiryOf(entry: GrokAuthEntry | undefined, accessToken: string | undefined): number | undefined;
/** The current access-token facts of one auth file. */
export declare function authState(file: GrokAuthFile | undefined): GrokAuthState;
/** Whether the access token is stale enough to warrant a refresh before use. */
export declare function needsRefresh(state: Pick<GrokAuthState, 'accessTokenExpiresAt'>, leadMs: number): boolean;
/**
 * Whether a refresh should run even though {@link needsRefresh} cannot say:
 * an expiry neither the document records nor the JWT decodes leaves the
 * short-lived Grok token unmeasurable, so it is refreshed rather than served
 * until the backend rejects it.
 */
export declare function expiryUnknown(state: Pick<GrokAuthState, 'accessToken' | 'accessTokenExpiresAt'>): boolean;
/**
 * Refresh the token set through the official OAuth endpoint. The request
 * mirrors the Grok CLI's wire format (form-encoded body, public client_id,
 * no client secret), so behaviour tracks the primary source exactly.
 */
export declare function refreshTokens(refreshToken: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<GrokTokenReply>;
/** Validate one token-endpoint reply into the fields this plugin records. */
export declare function parseTokenReply(parsed: unknown, action: string): GrokTokenReply;
/**
 * Fold a token reply into the auth document, preserving every unknown field
 * and entry. Writes land in the field aliases the entry already uses, so the
 * official CLI keeps recognising the file it owns.
 */
export declare function mergeRefreshed(file: GrokAuthFile, entryKey: string, reply: GrokTokenReply): GrokAuthFile;
/**
 * Fold a completed device-code login into the auth document under the
 * official entry key, creating a minimal CLI-shaped entry when none exists
 * and preserving identity facts when one does.
 */
export declare function mergeDeviceLogin(file: GrokAuthFile | undefined, reply: GrokTokenReply): GrokAuthFile;
/** Persist an auth document atomically at 0600, matching the Grok CLI's own writes. */
export declare function writeAuthFile(path: string, file: GrokAuthFile): Promise<void>;
/**
 * Start one RFC 8628 device authorization against the official endpoint. The
 * verification URI is forced to https so a malicious reply cannot make the
 * settings card link to something else.
 */
export declare function requestDeviceCode(fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<GrokDeviceAuthorization>;
/** Poll the token endpoint once for a pending device authorization. */
export declare function pollDeviceToken(deviceCode: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<GrokDevicePollResult>;
