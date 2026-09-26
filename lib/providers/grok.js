/**
 * xAI Grok (SuperGrok / X Premium subscription) usage adapter.
 *
 * dsh-grok-auth reads the official Grok CLI's auth document
 * (`~/.grok/auth.json`) and exposes the account's weekly credit usage through
 * its `grokAuth` cordis service and a plugin-owned Connection RPC channel.
 * That channel is browser-authenticated (`authority: loopback`) and not
 * callable with a plain server-side fetch, so this adapter reads the *same*
 * auth document directly and calls the same read-only billing endpoint the
 * sibling plugin uses:
 *
 * `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`
 *
 * The entry key is the OAuth access token (`key`, with `access_token` as the
 * legacy alias), and the selected entry matches the Grok CLI client id so a
 * multi-account document resolves the same row the CLI itself would.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/grok
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clampPercent, fetchJson, isRecord, num, reasonOf, str, toIso, usedFromRemaining, windowOf, } from './util.js';
const USAGE_ENDPOINT = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
/** The token-channel marker the official Grok CLI sends to its proxy backend. */
const USAGE_TOKEN_HEADER = 'xai-grok-cli';
/** The Grok CLI's public OAuth client id; identifies the account row to use. */
const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
/** The upstream period marker naming the weekly credit window. */
const WEEKLY_PERIOD = 'USAGE_PERIOD_TYPE_WEEKLY';
/** Resolve the auth document path the way the Grok CLI does. */
function authPath() {
    const home = process.env['GROK_HOME'];
    return home !== undefined && home.length > 0 ? join(home, 'auth.json') : join(homedir(), '.grok', 'auth.json');
}
/** Select the CLI's own account entry out of a possibly multi-entry document. */
function selectEntry(file) {
    const entries = Object.entries(file).filter((pair) => isRecord(pair[1]));
    if (entries.length === 0)
        return undefined;
    const exact = entries.find(([key]) => key.endsWith(`::${GROK_CLIENT_ID}`)) ??
        entries.find(([, entry]) => entry['oidc_client_id'] === GROK_CLIENT_ID) ??
        (entries.length === 1 ? entries[0] : undefined);
    return exact?.[1];
}
/** Read the access token across the field aliases the CLI has used. */
function accessTokenOf(entry) {
    return str(entry, 'key') ?? str(entry, 'access_token');
}
/**
 * Read the Grok weekly credit position.
 *
 * The upstream reports `creditUsagePercent` (consumed) inside a `config`
 * envelope, plus the current period. A weekly period with no percentage means
 * an untouched window, which reads as 0% used rather than unknown.
 *
 * @param ctx - host-provided deps.
 * @returns the provider snapshot.
 */
export async function readGrok(ctx) {
    const base = { id: 'grok', name: 'Grok', fetchedAt: Date.now() };
    let document;
    try {
        document = JSON.parse(await readFile(authPath(), 'utf8'));
    }
    catch {
        return {
            ...base,
            status: 'unconfigured',
            windows: [],
            error: 'Grok CLI is not signed in (~/.grok/auth.json)',
        };
    }
    if (!isRecord(document)) {
        return { ...base, status: 'unconfigured', windows: [], error: 'Grok auth document is malformed' };
    }
    const entry = selectEntry(document);
    const token = entry === undefined ? undefined : accessTokenOf(entry);
    if (token === undefined) {
        return { ...base, status: 'unconfigured', windows: [], error: 'Grok auth document carries no access token' };
    }
    const account = entry === undefined ? undefined : str(entry, 'email');
    try {
        // The billing probe answers an empty object for a rejected token rather
        // than an HTTP error, so a non-ok status is surfaced as an error row.
        const payload = await fetchJson(USAGE_ENDPOINT, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${token}`,
                'x-xai-token-auth': USAGE_TOKEN_HEADER,
                accept: 'application/json',
                'user-agent': 'dsh-proxy-monitor/0.2.0',
            },
        });
        if (!isRecord(payload))
            throw new Error('malformed billing response');
        const config = isRecord(payload['config']) ? payload['config'] : undefined;
        if (config === undefined) {
            return {
                ...base,
                status: 'error',
                windows: [],
                ...(account === undefined ? {} : { account }),
                error: 'Grok billing response carried no config',
            };
        }
        const period = isRecord(config['currentPeriod']) ? config['currentPeriod'] : undefined;
        const weekly = period !== undefined && period['type'] === WEEKLY_PERIOD;
        const rawUsed = num(config, 'creditUsagePercent');
        const windows = [];
        if (rawUsed !== undefined || weekly) {
            const used = clampPercent(rawUsed ?? 0);
            windows.push(windowOf({ id: 'weekly-credits', label: 'Weekly credits', kind: 'weekly' }, {
                usedPercent: used,
                resetAt: weekly ? toIso(period?.['end']) : undefined,
                detail: 'subscription credit window',
            }));
        }
        if (windows.length === 0) {
            return {
                ...base,
                status: 'error',
                windows: [],
                ...(account === undefined ? {} : { account }),
                error: 'Grok reported no usage fields',
            };
        }
        const headline = windows[0];
        return {
            ...base,
            status: 'ok',
            plan: 'SuperGrok subscription',
            ...(account === undefined ? {} : { account }),
            ...(headline?.usedPercent === undefined ? {} : { usedPercent: headline.usedPercent }),
            windows,
        };
    }
    catch (error) {
        return {
            ...base,
            status: 'error',
            windows: [],
            ...(account === undefined ? {} : { account }),
            error: reasonOf(error),
        };
    }
}
/**
 * Convert a remaining-percent reading into the consumed share, mirroring the
 * sibling plugin's own arithmetic (exposed for tests).
 * @param remainingPercent - remaining share 0-100.
 * @returns consumed share 0-100.
 */
export function usedPercentFromRemaining(remainingPercent) {
    return usedFromRemaining(clampPercent(remainingPercent));
}
//# sourceMappingURL=grok.js.map