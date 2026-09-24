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
import { homedir } from 'node:os';
import { join } from 'node:path';
import { open, readFile, stat } from 'node:fs/promises';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
/** The public OAuth client id xAI ships for the official Grok CLI's desktop flow. */
export const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
/** The OIDC issuer the Grok CLI authenticates against. */
export const GROK_OAUTH_ISSUER = 'https://auth.x.ai';
/** The OAuth token endpoint used for refresh and device-code polling. */
export const GROK_OAUTH_TOKEN_URL = 'https://auth.x.ai/oauth2/token';
/** The RFC 8628 device-authorization endpoint. */
export const GROK_OAUTH_DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code';
/** Scopes matching the official CLI login: identity, refresh, CLI and API access. */
export const GROK_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
/** The auth-document entry key the official Grok CLI writes for this issuer/client pair. */
export const GROK_AUTH_ENTRY_KEY = `${GROK_OAUTH_ISSUER}::${GROK_OAUTH_CLIENT_ID}`;
/** Default lead time before the access token expires that a refresh is triggered (the CLI's own GROK_AUTH_EARLY_INVALIDATION_SECS default). */
export const DEFAULT_REFRESH_LEAD_MS = 5 * 60 * 1000;
/** Access-token lifetime assumed when a token reply names none and the JWT is opaque. */
export const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
/** The auth file path for the current environment (GROK_HOME overrides ~/.grok). */
export function defaultAuthJsonPath(env = process.env) {
    const home = env.GROK_HOME;
    return home !== undefined && home.length > 0 ? join(home, 'auth.json') : join(homedir(), '.grok', 'auth.json');
}
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
export function dshLockTargetFor(authJsonPath) {
    return `${authJsonPath}.dsh`;
}
/**
 * Decode the JWT payload of a Grok access token without verifying it. The
 * `exp` claim is the expiry fallback when the document names none; `email` is
 * absent from access tokens, so identity facts stay entry-owned.
 */
export function decodeAccessToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return {};
        const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
        return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? { expSeconds: payload.exp } : {};
    }
    catch {
        return {};
    }
}
/**
 * Read and parse the Grok auth file. Absence answers `undefined`; a malformed
 * document throws — a file that exists but cannot be trusted must never read
 * as "no login" on the settings page.
 */
export async function readAuthFile(path) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch (error) {
        if (isNotFound(error))
            return undefined;
        throw error;
    }
    return parseAuthFile(path, text);
}
/**
 * Read auth bytes and version facts from one open file descriptor. Atomic
 * replacement after the open leaves this snapshot bound to the old inode, so
 * a later path stat reliably invalidates it instead of pairing old bytes with
 * a new file's timestamp.
 */
export async function readAuthSnapshot(path) {
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch (error) {
        if (isNotFound(error))
            return undefined;
        throw error;
    }
    try {
        const before = versionFromStat(await handle.stat({ bigint: true }));
        const text = await handle.readFile('utf8');
        const after = versionFromStat(await handle.stat({ bigint: true }));
        if (!sameAuthFileVersion(before, after)) {
            throw new Error(`grok-auth: ${path} changed while it was being read`);
        }
        return { file: parseAuthFile(path, text), version: after };
    }
    finally {
        await handle.close();
    }
}
/** Read only the current path version for a cheap credential-cache check. */
export async function readAuthFileVersion(path) {
    try {
        return versionFromStat(await stat(path, { bigint: true }));
    }
    catch (error) {
        if (isNotFound(error))
            return undefined;
        throw error;
    }
}
/** Exact equality for the inode and freshness fields used by the auth cache. */
export function sameAuthFileVersion(left, right) {
    return left.dev === right.dev
        && left.ino === right.ino
        && left.size === right.size
        && left.mtimeNs === right.mtimeNs
        && left.ctimeNs === right.ctimeNs;
}
function versionFromStat(value) {
    return {
        dev: value.dev,
        ino: value.ino,
        size: value.size,
        mtimeNs: value.mtimeNs,
        ctimeNs: value.ctimeNs,
    };
}
function parseAuthFile(path, text) {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new TypeError(`grok-auth: ${path} must be a JSON object`);
    }
    return parsed;
}
function isNotFound(error) {
    return error?.code === 'ENOENT';
}
/**
 * Select the account entry this plugin coordinates. Preference order: the
 * exact `<issuer>::<client_id>` key the official CLI writes, any entry keyed
 * for the same client id, any entry claiming the same `oidc_client_id`, then
 * a lone entry of any key — so a renamed or older store still resolves.
 */
export function selectAuthEntry(file) {
    if (file === undefined)
        return undefined;
    const entries = Object.entries(file).filter((pair) => isRecord(pair[1]));
    if (entries.length === 0)
        return undefined;
    const exact = entries.find(([key]) => key === GROK_AUTH_ENTRY_KEY)
        ?? entries.find(([key]) => key.endsWith(`::${GROK_OAUTH_CLIENT_ID}`))
        ?? entries.find(([, entry]) => entry.oidc_client_id === GROK_OAUTH_CLIENT_ID)
        ?? (entries.length === 1 ? entries[0] : undefined);
    return exact === undefined ? undefined : { entryKey: exact[0], entry: exact[1] };
}
/** The entry's access token across field aliases, when present and non-empty. */
export function accessTokenOf(entry) {
    return nonBlank(entry?.key) ?? nonBlank(entry?.access_token);
}
/** The entry's refresh token across field aliases, when present and non-empty. */
export function refreshTokenOf(entry) {
    return nonBlank(entry?.refresh_token) ?? nonBlank(entry?.refresh);
}
/**
 * The access token's expiry in epoch milliseconds: the entry's recorded
 * `expires_at`/`expires` when parseable, else the JWT `exp` claim.
 */
export function expiryOf(entry, accessToken) {
    const recorded = entry?.expires_at ?? entry?.expires;
    if (typeof recorded === 'number' && Number.isFinite(recorded) && recorded > 0)
        return recorded;
    if (typeof recorded === 'string' && recorded.length > 0) {
        const at = Date.parse(recorded);
        if (Number.isFinite(at))
            return at;
    }
    if (accessToken === undefined)
        return undefined;
    const expSeconds = decodeAccessToken(accessToken).expSeconds;
    return expSeconds === undefined ? undefined : expSeconds * 1000;
}
/** The current access-token facts of one auth file. */
export function authState(file) {
    const selected = selectAuthEntry(file);
    const accessToken = accessTokenOf(selected?.entry);
    return {
        file,
        entry: selected?.entry,
        entryKey: selected?.entryKey,
        accessToken,
        accessTokenExpiresAt: accessToken === undefined ? undefined : expiryOf(selected?.entry, accessToken),
    };
}
/** Whether the access token is stale enough to warrant a refresh before use. */
export function needsRefresh(state, leadMs) {
    return state.accessTokenExpiresAt !== undefined && state.accessTokenExpiresAt - Date.now() < leadMs;
}
/**
 * Whether a refresh should run even though {@link needsRefresh} cannot say:
 * an expiry neither the document records nor the JWT decodes leaves the
 * short-lived Grok token unmeasurable, so it is refreshed rather than served
 * until the backend rejects it.
 */
export function expiryUnknown(state) {
    return state.accessToken !== undefined && state.accessTokenExpiresAt === undefined;
}
/**
 * Refresh the token set through the official OAuth endpoint. The request
 * mirrors the Grok CLI's wire format (form-encoded body, public client_id,
 * no client secret), so behaviour tracks the primary source exactly.
 */
export async function refreshTokens(refreshToken, fetchImpl = fetch, signal) {
    const response = await fetchImpl(GROK_OAUTH_TOKEN_URL, {
        method: 'POST',
        ...(signal === undefined ? {} : { signal }),
        headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: GROK_OAUTH_CLIENT_ID,
            refresh_token: refreshToken,
        }).toString(),
    });
    if (!response.ok) {
        throw new Error(`grok-auth: token refresh answered ${response.status}`);
    }
    return parseTokenReply(await response.json(), 'token refresh');
}
/** Validate one token-endpoint reply into the fields this plugin records. */
export function parseTokenReply(parsed, action) {
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(`grok-auth: ${action} reply is not a JSON object`);
    }
    const reply = parsed;
    if (typeof reply.access_token !== 'string' || reply.access_token.length === 0) {
        throw new Error(`grok-auth: ${action} reply carries no access_token`);
    }
    return {
        access_token: reply.access_token,
        ...typeof reply.refresh_token === 'string' && reply.refresh_token.length > 0
            ? { refresh_token: reply.refresh_token }
            : {},
        ...typeof reply.expires_in === 'number' && Number.isFinite(reply.expires_in) && reply.expires_in > 0
            ? { expires_in: reply.expires_in }
            : {},
    };
}
/** The expiry a token reply implies, from `expires_in`, the JWT, or the default lifetime. */
function replyExpiresAt(reply, now) {
    if (reply.expires_in !== undefined)
        return now + reply.expires_in * 1000;
    const expSeconds = decodeAccessToken(reply.access_token).expSeconds;
    return expSeconds === undefined ? now + DEFAULT_TOKEN_LIFETIME_SECONDS * 1000 : expSeconds * 1000;
}
/**
 * Fold a token reply into the auth document, preserving every unknown field
 * and entry. Writes land in the field aliases the entry already uses, so the
 * official CLI keeps recognising the file it owns.
 */
export function mergeRefreshed(file, entryKey, reply) {
    const existing = isRecord(file[entryKey]) ? file[entryKey] : {};
    const now = Date.now();
    const entry = { ...existing };
    // Access token: `key` is the current CLI field; only a legacy entry that
    // used `access_token` alone keeps that spelling.
    if (nonBlank(existing.key) !== undefined || nonBlank(existing.access_token) === undefined) {
        entry.key = reply.access_token;
    }
    if (nonBlank(existing.access_token) !== undefined)
        entry.access_token = reply.access_token;
    if (reply.refresh_token !== undefined) {
        if (nonBlank(existing.refresh_token) !== undefined || nonBlank(existing.refresh) === undefined) {
            entry.refresh_token = reply.refresh_token;
        }
        if (nonBlank(existing.refresh) !== undefined)
            entry.refresh = reply.refresh_token;
    }
    const expiresAtIso = new Date(replyExpiresAt(reply, now)).toISOString();
    if (existing.expires_at !== undefined || existing.expires === undefined)
        entry.expires_at = expiresAtIso;
    if (existing.expires !== undefined) {
        entry.expires = typeof existing.expires === 'number' ? replyExpiresAt(reply, now) : expiresAtIso;
    }
    entry.create_time = new Date(now).toISOString();
    return { ...file, [entryKey]: entry };
}
/**
 * Fold a completed device-code login into the auth document under the
 * official entry key, creating a minimal CLI-shaped entry when none exists
 * and preserving identity facts when one does.
 */
export function mergeDeviceLogin(file, reply) {
    const base = file === undefined ? {} : file;
    const selected = selectAuthEntry(base);
    const entryKey = selected?.entryKey ?? GROK_AUTH_ENTRY_KEY;
    const seeded = selected === undefined
        ? {
            ...base,
            [entryKey]: {
                auth_mode: 'oidc',
                oidc_issuer: GROK_OAUTH_ISSUER,
                oidc_client_id: GROK_OAUTH_CLIENT_ID,
            },
        }
        : base;
    return mergeRefreshed(seeded, entryKey, reply);
}
/** Persist an auth document atomically at 0600, matching the Grok CLI's own writes. */
export async function writeAuthFile(path, file) {
    await writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 });
}
/**
 * Start one RFC 8628 device authorization against the official endpoint. The
 * verification URI is forced to https so a malicious reply cannot make the
 * settings card link to something else.
 */
export async function requestDeviceCode(fetchImpl = fetch, signal) {
    const response = await fetchImpl(GROK_OAUTH_DEVICE_CODE_URL, {
        method: 'POST',
        ...(signal === undefined ? {} : { signal }),
        headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: GROK_OAUTH_CLIENT_ID,
            scope: GROK_OAUTH_SCOPE,
            referrer: 'dsh',
        }).toString(),
    });
    if (!response.ok) {
        throw new Error(`grok-auth: device authorization answered ${response.status}`);
    }
    const body = await response.json();
    if (!isRecord(body))
        throw new Error('grok-auth: device authorization reply is not a JSON object');
    const interval = body.interval;
    const complete = typeof body.verification_uri_complete === 'string' && body.verification_uri_complete.length > 0
        ? validateVerificationUri(body.verification_uri_complete)
        : undefined;
    return {
        deviceCode: requiredString(body, 'device_code'),
        userCode: requiredString(body, 'user_code'),
        verificationUri: validateVerificationUri(requiredString(body, 'verification_uri')),
        ...complete === undefined ? {} : { verificationUriComplete: complete },
        ...typeof interval === 'number' && Number.isFinite(interval) && interval > 0
            ? { intervalSeconds: interval }
            : {},
        expiresInSeconds: requiredPositiveNumber(body, 'expires_in'),
    };
}
/** Poll the token endpoint once for a pending device authorization. */
export async function pollDeviceToken(deviceCode, fetchImpl = fetch, signal) {
    const response = await fetchImpl(GROK_OAUTH_TOKEN_URL, {
        method: 'POST',
        ...(signal === undefined ? {} : { signal }),
        headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: GROK_OAUTH_CLIENT_ID,
            device_code: deviceCode,
        }).toString(),
    });
    let body;
    try {
        body = await response.json();
    }
    catch {
        return { status: 'failed', message: `grok-auth: device token polling answered non-JSON HTTP ${response.status}` };
    }
    if (response.ok) {
        return { status: 'complete', reply: parseTokenReply(body, 'device login') };
    }
    const error = isRecord(body) ? body.error : undefined;
    if (error === 'authorization_pending')
        return { status: 'pending' };
    if (error === 'slow_down') {
        const interval = isRecord(body) ? body.interval : undefined;
        return { status: 'slow_down', ...typeof interval === 'number' ? { intervalSeconds: interval } : {} };
    }
    if (error === 'access_denied' || error === 'authorization_denied') {
        return { status: 'failed', message: 'device authorization was denied' };
    }
    if (error === 'expired_token') {
        return { status: 'failed', message: 'device code expired before it was approved' };
    }
    return { status: 'failed', message: `device token polling answered HTTP ${response.status}` };
}
function validateVerificationUri(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error('grok-auth: untrusted verification URI in device authorization reply');
    }
    if (url.protocol !== 'https:') {
        throw new Error('grok-auth: untrusted verification URI in device authorization reply');
    }
    return url.href;
}
function requiredString(body, field) {
    const value = body[field];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`grok-auth: device authorization reply lacks ${field}`);
    }
    return value;
}
function requiredPositiveNumber(body, field) {
    const value = body[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`grok-auth: device authorization reply lacks ${field}`);
    }
    return value;
}
function nonBlank(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=grok-auth.js.map