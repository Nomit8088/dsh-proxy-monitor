/**
 * DeepSeek official balance adapter.
 *
 * The official API exposes an account balance, not a subscription window:
 * `GET https://api.deepseek.com/user/balance` answers the topped-up and
 * granted credit per currency. There is no percentage to meter, so this
 * provider reports a balance row and leaves `usedPercent` absent — the sidebar
 * renders it as a text badge instead of a ring.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/deepseek
 */
import { fetchJson, isRecord, num, reasonOf, str, windowOf } from './util.js';
/** The credential reference the official DeepSeek key is stored under. */
const DEEPSEEK_CREDENTIAL_REF = 'DEEPSEEK_API_KEY';
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
/** Currency symbol for the currencies DeepSeek bills in. */
function symbolOf(currency) {
    if (currency === 'CNY')
        return '¥';
    if (currency === 'USD')
        return '$';
    return `${currency} `;
}
/**
 * Read the DeepSeek account balance.
 *
 * A missing key yields `unconfigured` (the user never signed in), while any
 * other failure yields `error` — the two are different problems and the
 * sidebar says so.
 *
 * @param ctx - host-provided deps (credential resolution).
 * @returns the provider snapshot.
 */
export async function readDeepSeek(ctx) {
    const base = { id: 'deepseek', name: 'DeepSeek', fetchedAt: Date.now() };
    const key = await ctx.credential(DEEPSEEK_CREDENTIAL_REF);
    if (key === undefined) {
        return {
            ...base,
            status: 'unconfigured',
            windows: [],
            error: `${DEEPSEEK_CREDENTIAL_REF} is not configured`,
        };
    }
    try {
        const body = await fetchJson(BALANCE_URL, {
            method: 'GET',
            headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        });
        if (!isRecord(body))
            throw new Error('malformed balance response');
        const available = body['is_available'] === true;
        const infos = Array.isArray(body['balance_infos']) ? body['balance_infos'] : [];
        const windows = [];
        let balance;
        for (const entry of infos) {
            if (!isRecord(entry))
                continue;
            const currency = str(entry, 'currency') ?? 'CNY';
            const total = str(entry, 'total_balance');
            if (total === undefined)
                continue;
            const granted = str(entry, 'granted_balance');
            const topped = str(entry, 'topped_up_balance');
            const shown = `${symbolOf(currency)}${total}`;
            balance ??= shown;
            const parts = [];
            if (topped !== undefined && topped !== '0.00')
                parts.push(`topped up ${symbolOf(currency)}${topped}`);
            if (granted !== undefined && granted !== '0.00')
                parts.push(`granted ${symbolOf(currency)}${granted}`);
            windows.push(windowOf({ id: `balance-${currency.toLowerCase()}`, label: `${currency} balance`, kind: 'balance' }, { detail: parts.length > 0 ? parts.join(' · ') : undefined }));
        }
        if (windows.length === 0) {
            return { ...base, status: 'error', windows: [], error: 'DeepSeek returned no balance rows' };
        }
        return {
            ...base,
            status: 'ok',
            plan: available ? 'Pay-as-you-go' : 'Balance unavailable',
            ...(balance === undefined ? {} : { balance }),
            windows,
        };
    }
    catch (error) {
        return { ...base, status: 'error', windows: [], error: reasonOf(error) };
    }
}
/**
 * Whether a DeepSeek response looks like a usable balance payload (exposed for
 * tests; the reader above is the production path).
 * @param value - candidate payload.
 * @returns true when at least one balance row carries a total.
 */
export function hasBalanceRows(value) {
    if (!isRecord(value))
        return false;
    const infos = value['balance_infos'];
    if (!Array.isArray(infos))
        return false;
    return infos.some(entry => isRecord(entry) && num(entry, 'total_balance') !== undefined);
}
//# sourceMappingURL=deepseek.js.map