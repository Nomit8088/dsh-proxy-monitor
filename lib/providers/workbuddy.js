/**
 * WorkBuddy / CodeBuddy credit adapter.
 *
 * dsh-workbuddy-connect already resolves the desktop app's sign-in and calls
 * the vendor billing endpoint, and publishes the result on its own loopback
 * route (`/plugins/dsh-workbuddy-connect/status`) as
 * `credits: { total, accounts: [{ packageName, remain, size }] }`.
 *
 * Those rows are the honest meter: each package has a granted `size` and a
 * remaining `remain`, so the consumed share is `(Σsize − Σremain) / Σsize`.
 * The plugin also reports a per-model `credits` multiplier (e.g. "x0.79"),
 * which is a *price ratio*, not an allowance — metering it would be wrong, so
 * it is surfaced as a detail line instead.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/workbuddy
 */
import { clampPercent, fetchJson, isRecord, num, reasonOf, str, toIso, windowOf, } from './util.js';
/** The plugin-owned route, served by dsh-workbuddy-connect's host half. */
const PLUGIN_STATUS_PATH = '/plugins/dsh-workbuddy-connect/status';
/** Read the credit accounts array defensively. */
function accountsOf(credits) {
    const raw = credits['accounts'];
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const entry of raw) {
        if (!isRecord(entry))
            continue;
        out.push({
            packageName: str(entry, 'packageName'),
            remain: num(entry, 'remain'),
            size: num(entry, 'size'),
        });
    }
    return out;
}
/**
 * Read the WorkBuddy credit position.
 *
 * @param ctx - host-provided deps.
 * @param pluginBase - origin of the running DSH web server.
 * @returns the provider snapshot.
 */
export async function readWorkBuddy(ctx, pluginBase) {
    const base = { id: 'workbuddy', name: 'WorkBuddy', fetchedAt: Date.now() };
    try {
        const payload = await fetchJson(`${pluginBase}${PLUGIN_STATUS_PATH}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
        });
        if (!isRecord(payload))
            throw new Error('malformed status response');
        const state = str(payload, 'status');
        if (state === 'signed-out') {
            return {
                ...base,
                status: 'unconfigured',
                windows: [],
                error: str(payload, 'reason') ?? 'WorkBuddy desktop app is not signed in',
            };
        }
        const account = str(payload, 'nickname') ?? str(payload, 'domain');
        const models = Array.isArray(payload['models']) ? payload['models'] : [];
        const creditsValue = payload['credits'];
        const creditsError = str(payload, 'creditsError');
        if (!isRecord(creditsValue)) {
            return {
                ...base,
                status: 'error',
                windows: [],
                ...(account === undefined ? {} : { account }),
                error: creditsError ?? 'WorkBuddy reported no credit rows',
            };
        }
        const accounts = accountsOf(creditsValue);
        const totalRemain = accounts.reduce((sum, row) => sum + (row.remain ?? 0), 0);
        const totalSize = accounts.reduce((sum, row) => sum + (row.size ?? 0), 0);
        const reportedTotal = num(creditsValue, 'total');
        const windows = [];
        if (totalSize > 0) {
            windows.push(windowOf({ id: 'credits', label: 'All packages', kind: 'credit' }, {
                usedPercent: clampPercent(((totalSize - totalRemain) / totalSize) * 100),
                detail: `${String(Math.round(totalRemain))} / ${String(Math.round(totalSize))} credits left`,
            }));
        }
        for (const [index, row] of accounts.entries()) {
            if (row.size === undefined || row.size <= 0 || row.remain === undefined)
                continue;
            windows.push(windowOf({ id: `package-${String(index)}`, label: row.packageName ?? `Package ${String(index + 1)}`, kind: 'credit' }, {
                usedPercent: clampPercent(((row.size - row.remain) / row.size) * 100),
                detail: `${String(Math.round(row.remain))} / ${String(Math.round(row.size))} credits`,
            }));
        }
        // The newest catalog fetch timestamp doubles as this snapshot's freshness.
        const catalog = payload['catalog'];
        const catalogAt = isRecord(catalog) ? toIso(catalog['fetchedAt']) : undefined;
        const plan = catalogAt === undefined
            ? undefined
            : `catalog ${new Date(catalogAt).toLocaleDateString()} · ${String(models.length)} models`;
        if (windows.length === 0) {
            return {
                ...base,
                status: 'ok',
                windows: [],
                ...(account === undefined ? {} : { account }),
                ...(plan === undefined ? {} : { plan }),
                ...(reportedTotal === undefined ? {} : { balance: `${String(Math.round(reportedTotal))} credits` }),
            };
        }
        const headline = windows[0];
        return {
            ...base,
            status: 'ok',
            ...(account === undefined ? {} : { account }),
            ...(plan === undefined ? {} : { plan }),
            balance: `${String(Math.round(totalRemain))} credits`,
            ...(headline?.usedPercent === undefined ? {} : { usedPercent: headline.usedPercent }),
            windows,
        };
    }
    catch (error) {
        return { ...base, status: 'error', windows: [], error: reasonOf(error) };
    }
}
//# sourceMappingURL=workbuddy.js.map