/**
 * Google Antigravity / Cloud Code Assist quota adapter.
 *
 * dsh-antigravity already owns the OAuth credential file, the project lookup,
 * and the quota-summary parsing, and publishes the normalized result on its own
 * loopback route (`/antigravity/api/quota`). This adapter consumes that route
 * first, because re-implementing the plugin's project-id resolution and tier
 * parsing would drift from it; when the route is absent it reads the
 * credential file and calls the upstream endpoint directly.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/antigravity
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clampPercent, fetchJson, PROVIDER_TIMEOUT_MS, isRecord, num, reasonOf, str, toIso, usedFromRemaining, windowOf, } from './util.js';
/** The plugin-owned route; its payload is already normalized by dsh-antigravity. */
const PLUGIN_QUOTA_PATH = '/antigravity/api/quota';
const UPSTREAM_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
/** Relative path of the OAuth document inside the DSH home. */
const CREDENTIAL_FILE = ['storages', 'antigravity-oauth.json'];
/**
 * Map a bucket's own window label onto the rendering class. The upstream
 * reports "5h" and "weekly" window ids, which are the two shapes the sidebar
 * knows how to group.
 */
function kindOfWindow(window) {
    if (typeof window !== 'string')
        return 'other';
    const lowered = window.toLowerCase();
    if (lowered.includes('5h') || lowered.includes('session') || lowered.includes('five'))
        return 'session';
    if (lowered.includes('week'))
        return 'weekly';
    if (lowered.includes('month'))
        return 'monthly';
    return 'other';
}
/**
 * Turn the plugin route's `bucketRows` into windows. These are the provider's
 * real allowances (a weekly and a 5-hour bucket per model group); the
 * per-model rows are one shared pool repeated per model and would show the
 * same number N times, so the group buckets are the honest headline.
 */
function windowsFromPlugin(payload) {
    const rows = Array.isArray(payload['bucketRows']) ? payload['bucketRows'] : [];
    const windows = [];
    for (const row of rows) {
        if (!isRecord(row))
            continue;
        const id = str(row, 'id');
        const remaining = num(row, 'remainingFraction');
        if (id === undefined || remaining === undefined)
            continue;
        const group = str(row, 'group');
        windows.push(windowOf({
            id,
            label: group === undefined ? (str(row, 'label') ?? id) : group,
            kind: kindOfWindow(row['window']),
        }, {
            usedPercent: usedFromRemaining(clampPercent(remaining * 100)),
            resetAt: toIso(row['resetTime']),
            detail: str(row, 'label'),
        }));
    }
    return windows;
}
/** Only use real per-model remaining fractions when grouped quota was denied. */
function windowsFromModels(payload) {
    const rows = Array.isArray(payload['modelRows']) ? payload['modelRows'] : [];
    const windows = [];
    for (const row of rows) {
        if (!isRecord(row))
            continue;
        const id = str(row, 'id');
        const remaining = num(row, 'remainingFraction');
        if (id === undefined || remaining === undefined)
            continue;
        windows.push(windowOf({ id: `model:${id}`, label: str(row, 'label') ?? id, kind: 'other' }, {
            usedPercent: usedFromRemaining(clampPercent(remaining * 100)),
            resetAt: toIso(row['resetTime']),
            detail: '模型接口返回的剩余额度；分组的 5 小时/每周额度未读取',
        }));
        if (windows.length >= 24)
            break;
    }
    return windows;
}
/**
 * Pick the headline window: the weekly bucket is the binding allowance, so it
 * leads; otherwise the first reported window does.
 * @param windows - every window read from the provider.
 * @returns the headline index, or undefined when there is nothing to show.
 */
function headlineIndex(windows) {
    const weekly = windows.findIndex(entry => entry.kind === 'weekly');
    if (weekly >= 0)
        return weekly;
    return windows.length > 0 ? 0 : undefined;
}
/** Read the OAuth document this plugin shares with dsh-antigravity. */
async function readCredential(home) {
    try {
        const raw = await readFile(join(home, ...CREDENTIAL_FILE), 'utf8');
        const parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Fallback path: call the upstream quota endpoint directly with the shared
 * OAuth access token. Used only when dsh-antigravity's own route is not
 * mounted (the plugin was removed, or its server died).
 */
async function readUpstream(home) {
    const credential = await readCredential(home);
    const token = credential === undefined ? undefined : str(credential, 'access');
    if (token === undefined)
        throw new Error('no Antigravity credential at storages/antigravity-oauth.json');
    const body = await fetchJson(`${UPSTREAM_ENDPOINT}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
        },
        body: '{}',
    });
    if (!isRecord(body))
        throw new Error('malformed quota response');
    return body;
}
/**
 * Parse the raw upstream `retrieveUserQuotaSummary` payload, which nests
 * buckets under quota groups. Kept minimal on purpose: the plugin route is the
 * preferred path and this only has to cover the direct-call case.
 */
function windowsFromUpstream(body) {
    const groupsValue = body['groups'];
    const groups = Array.isArray(groupsValue) ? groupsValue : [];
    const windows = [];
    for (const group of groups) {
        if (!isRecord(group))
            continue;
        const groupName = str(group, 'displayName') ?? 'Quota';
        const buckets = Array.isArray(group['buckets']) ? group['buckets'] : [];
        for (const bucket of buckets) {
            if (!isRecord(bucket))
                continue;
            const id = str(bucket, 'bucketId');
            const remaining = num(bucket, 'remainingFraction');
            if (remaining === undefined)
                continue;
            const windowId = str(bucket, 'window') ?? id ?? groupName;
            windows.push(windowOf({ id: `${groupName}:${windowId}`, label: groupName, kind: kindOfWindow(bucket['window']) }, {
                usedPercent: usedFromRemaining(clampPercent(remaining * 100)),
                resetAt: toIso(bucket['resetTime']),
                detail: str(bucket, 'displayName') ?? id,
            }));
        }
    }
    return windows;
}
/**
 * Read the Antigravity quota.
 * @param ctx - host-provided deps.
 * @param pluginBase - origin of the running DSH web server.
 * @returns the provider snapshot.
 */
export async function readAntigravity(ctx, pluginBase) {
    const base = { id: 'antigravity', name: 'Antigravity', fetchedAt: Date.now() };
    try {
        // Prefer the sibling runtime: it refreshes OAuth, probes both endpoints and
        // knows which project this account uses. Its upstream 403/500 is authoritative
        // and must not trigger a *second*, production-only call with a stale raw
        // access token that replaces the useful provider reason with `HTTP 403`.
        // Only an absent route (404) or missing local server may use the fallback.
        let routeMissing = false;
        try {
            const response = await fetch(`${pluginBase}${PLUGIN_QUOTA_PATH}`, {
                method: 'GET',
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
            });
            if (response.status === 404) {
                routeMissing = true;
                throw new Error('quota route is not mounted');
            }
            const payload = await response.json().catch(() => undefined);
            if (!response.ok) {
                const details = isRecord(payload) ? str(payload, 'error') : undefined;
                throw new Error(`Antigravity quota route HTTP ${String(response.status)}${details ? `: ${reasonOf(details)}` : ''}`);
            }
            if (!isRecord(payload) || payload['ok'] !== true || !isRecord(payload['value'])) {
                throw new Error('plugin route answered an unexpected payload');
            }
            const value = payload['value'];
            const grouped = windowsFromPlugin(value);
            const windows = grouped.length > 0 ? grouped : windowsFromModels(value);
            if (windows.length === 0)
                throw new Error(str(value, 'quotaError') ?? 'plugin route reported no quota data');
            return {
                ...base,
                status: 'ok',
                plan: str(value, 'planLabel'),
                account: str(value, 'projectId'),
                usedPercent: windows[headlineIndex(windows) ?? 0]?.usedPercent,
                windows,
            };
        }
        catch (routeError) {
            if (!routeMissing && !(routeError instanceof TypeError))
                throw routeError;
            ctx.warn('antigravity', `plugin route unavailable (${reasonOf(routeError)}); calling upstream directly`);
        }
        // Fallback only for a genuinely absent local route.
        const windows = windowsFromUpstream(await readUpstream(ctx.home));
        if (windows.length === 0)
            throw new Error('upstream reported no quota buckets');
        return {
            ...base,
            status: 'ok',
            usedPercent: windows[headlineIndex(windows) ?? 0]?.usedPercent,
            windows,
        };
    }
    catch (error) {
        const message = reasonOf(error);
        // A missing credential is "not configured", not a failure worth alerting on.
        if (message.includes('no Antigravity credential')) {
            return { ...base, status: 'unconfigured', windows: [], error: message };
        }
        return { ...base, status: 'error', windows: [], error: message };
    }
}
//# sourceMappingURL=antigravity.js.map