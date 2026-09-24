/**
 * Claude / Anthropic subscription usage adapter.
 *
 * Claude Code reads its own subscription usage from an undocumented OAuth
 * endpoint — `GET https://api.anthropic.com/api/oauth/usage` — which answers
 * the 5-hour rolling session window and the 7-day weekly window as
 * `{ utilization, resets_at }` pairs. `utilization` is already a consumed
 * percentage, and `anthropic-beta: oauth-2025-04-20` is required or the
 * endpoint answers 401.
 *
 * This environment currently holds no Claude credential, so the adapter
 * normally reports `unconfigured`. It is implemented rather than stubbed so
 * that signing the Claude Code CLI in on this machine makes the row appear
 * with no further change. The credential is read from the CLI's own document
 * (`~/.claude/.credentials.json` → `claudeAiOauth.accessToken`); the sibling
 * `mcpOAuth.*` entries are unrelated MCP tokens and are deliberately ignored.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/claude
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clampPercent, fetchJson, isRecord, num, reasonOf, str, toIso, windowOf, } from './util.js';
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/** Required beta channel; without it the endpoint rejects the session. */
const OAUTH_BETA = 'oauth-2025-04-20';
/** The window fields the endpoint reports, in display order. */
const WINDOW_FIELDS = [
    { field: 'five_hour', label: 'Current session', kind: 'session' },
    { field: 'seven_day', label: 'All models', kind: 'weekly' },
    { field: 'seven_day_sonnet', label: 'Sonnet only', kind: 'weekly' },
    { field: 'seven_day_opus', label: 'Opus only', kind: 'weekly' },
];
/** Resolve the Claude Code credential document path. */
function credentialPath() {
    const home = process.env['CLAUDE_CONFIG_DIR'];
    const base = home !== undefined && home.length > 0 ? home : join(homedir(), '.claude');
    return join(base, '.credentials.json');
}
/**
 * Read the Claude subscription windows.
 * @param ctx - host-provided deps.
 * @returns the provider snapshot.
 */
export async function readClaude(ctx) {
    const base = { id: 'claude', name: 'Claude', fetchedAt: Date.now() };
    let document;
    try {
        document = JSON.parse(await readFile(credentialPath(), 'utf8'));
    }
    catch {
        return {
            ...base,
            status: 'unconfigured',
            windows: [],
            error: 'Claude Code is not signed in (~/.claude/.credentials.json)',
        };
    }
    if (!isRecord(document)) {
        return { ...base, status: 'unconfigured', windows: [], error: 'Claude credential document is malformed' };
    }
    // Only `claudeAiOauth` is the subscription session; `mcpOAuth.*` holds
    // unrelated MCP server tokens that would authenticate as the wrong thing.
    const oauth = isRecord(document['claudeAiOauth']) ? document['claudeAiOauth'] : undefined;
    const token = oauth === undefined ? undefined : str(oauth, 'accessToken');
    if (token === undefined) {
        return {
            ...base,
            status: 'unconfigured',
            windows: [],
            error: 'Claude credential document carries no subscription session',
        };
    }
    const plan = oauth === undefined ? undefined : str(oauth, 'subscriptionType');
    try {
        const payload = await fetchJson(USAGE_URL, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${token}`,
                'anthropic-beta': OAUTH_BETA,
                accept: 'application/json',
            },
        });
        if (!isRecord(payload))
            throw new Error('malformed usage response');
        const windows = [];
        for (const spec of WINDOW_FIELDS) {
            const entry = payload[spec.field];
            if (!isRecord(entry))
                continue;
            const utilization = num(entry, 'utilization');
            if (utilization === undefined)
                continue;
            windows.push(windowOf({ id: spec.field, label: spec.label, kind: spec.kind }, { usedPercent: clampPercent(utilization), resetAt: toIso(entry['resets_at']) }));
        }
        if (windows.length === 0) {
            // Both windows null means API-key billing: a real answer, not a failure.
            return {
                ...base,
                status: 'unconfigured',
                windows: [],
                error: 'Claude account reports no subscription windows (API-key billing)',
            };
        }
        const headline = windows[0];
        return {
            ...base,
            status: 'ok',
            ...(plan === undefined ? {} : { plan: `${plan} subscription` }),
            ...(headline?.usedPercent === undefined ? {} : { usedPercent: headline.usedPercent }),
            windows,
        };
    }
    catch (error) {
        return { ...base, status: 'error', windows: [], error: reasonOf(error) };
    }
}
//# sourceMappingURL=claude.js.map