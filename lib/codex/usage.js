/** Live ChatGPT Codex rate-limit usage for the browser account page. */
import { createModels } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { OPENAI_CODEX_PROVIDER } from './store.js';
/** Fixed endpoint used by the official Codex client for ChatGPT rate limits. */
export const OPENAI_CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const USAGE_REQUEST_TIMEOUT_MS = 15_000;
/** Stable public discriminant for an expired or revoked Codex OAuth session. */
export const OPENAI_CODEX_REAUTH_REQUIRED_CODE = 'OPENAI_CODEX_REAUTH_REQUIRED';
/** Fixed, secret-free message for a browser-facing reauthorization prompt. */
export const OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE = 'OpenAI Codex authorization must be renewed';
/**
 * Raised when the usage endpoint rejects the current OAuth session.
 *
 * The error intentionally carries no response, credential, or account data so
 * callers can safely pass its fixed message across the Web boundary.
 */
export class OpenAICodexReauthRequiredError extends Error {
    code = OPENAI_CODEX_REAUTH_REQUIRED_CODE;
    constructor() {
        super(OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE);
        this.name = 'OpenAICodexReauthRequiredError';
    }
}
/** Identify the dedicated reauthorization failure without comparing messages. */
export function isOpenAICodexReauthRequiredError(error) {
    return error instanceof OpenAICodexReauthRequiredError;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** JavaScript Date's maximum representable instant, expressed in Unix seconds. */
const MAX_DATE_UNIX_SECONDS = Math.floor(8_640_000_000_000_000 / 1_000);
function parseResetAt(record) {
    if (!Object.hasOwn(record, 'reset_at'))
        return undefined;
    const value = record['reset_at'];
    if (value === null)
        return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_DATE_UNIX_SECONDS) {
        throw new Error('OpenAI Codex returned an invalid rate-limit reset time');
    }
    // Keep the projection bounded by Date's actual range rather than allowing an
    // integer that would overflow when a browser formats it as milliseconds.
    if (!Number.isFinite(new Date(value * 1_000).getTime())) {
        throw new Error('OpenAI Codex returned an invalid rate-limit reset time');
    }
    return value;
}
function parseWindow(value) {
    if (value === undefined || value === null)
        return undefined;
    if (!isRecord(value))
        throw new Error('OpenAI Codex returned a malformed rate-limit window');
    const usedPercent = value['used_percent'];
    const windowSeconds = value['limit_window_seconds'];
    if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
        throw new Error('OpenAI Codex returned an invalid used percentage');
    }
    if (typeof windowSeconds !== 'number' || !Number.isInteger(windowSeconds) || windowSeconds <= 0) {
        throw new Error('OpenAI Codex returned an invalid rate-limit window duration');
    }
    const resetAt = parseResetAt(value);
    return {
        remainingPercent: 100 - usedPercent,
        windowSeconds,
        ...resetAt === undefined ? {} : { resetAt },
    };
}
function parseLimit(id, name, value) {
    if (value === undefined || value === null)
        return undefined;
    if (!isRecord(value))
        throw new Error('OpenAI Codex returned malformed rate-limit details');
    const windows = [parseWindow(value['primary_window']), parseWindow(value['secondary_window'])]
        .filter(window => window !== undefined);
    return windows.length === 0 ? undefined : { id, ...name === undefined ? {} : { name }, windows };
}
function exactAmount(record, key) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0 || value.length > 64 || !/^-?\d+(?:\.\d+)?$/u.test(value)) {
        throw new Error(`OpenAI Codex returned an invalid ${key} amount`);
    }
    return value;
}
function parseCredits(value) {
    if (value === undefined || value === null)
        return undefined;
    if (!isRecord(value) || typeof value['has_credits'] !== 'boolean' || typeof value['unlimited'] !== 'boolean') {
        throw new Error('OpenAI Codex returned malformed credit details');
    }
    if (!value['has_credits'])
        return undefined;
    const balance = value['balance'];
    if (balance !== undefined && balance !== null
        && (typeof balance !== 'string' || balance.length === 0 || balance.length > 64 || !/^-?\d+(?:\.\d+)?$/u.test(balance))) {
        throw new Error('OpenAI Codex returned an invalid credit balance');
    }
    return {
        unlimited: value['unlimited'],
        ...typeof balance === 'string' ? { balance } : {},
    };
}
function parseIndividualLimit(value) {
    if (value === undefined || value === null)
        return undefined;
    if (!isRecord(value))
        throw new Error('OpenAI Codex returned malformed spend-control details');
    const individual = value['individual_limit'];
    if (individual === undefined || individual === null)
        return undefined;
    if (!isRecord(individual))
        throw new Error('OpenAI Codex returned a malformed individual limit');
    const remainingPercent = individual['remaining_percent'];
    if (typeof remainingPercent !== 'number' || !Number.isFinite(remainingPercent)
        || remainingPercent < 0 || remainingPercent > 100) {
        throw new Error('OpenAI Codex returned an invalid individual-limit percentage');
    }
    return {
        limit: exactAmount(individual, 'limit'),
        used: exactAmount(individual, 'used'),
        remaining: exactAmount(individual, 'remaining'),
        remainingPercent,
    };
}
/**
 * Convert the provider response into the small secret-free object sent to the browser.
 * @param value - opaque JSON returned by the ChatGPT usage endpoint.
 * @returns core and additionally metered quota buckets with remaining percentages.
 */
export function parseOpenAICodexUsage(value) {
    if (!isRecord(value))
        throw new Error('OpenAI Codex returned a malformed usage response');
    const limits = [];
    const primary = parseLimit('codex', 'Codex', value['rate_limit']);
    if (primary !== undefined)
        limits.push(primary);
    const additional = value['additional_rate_limits'];
    if (additional !== undefined && additional !== null && !Array.isArray(additional)) {
        throw new Error('OpenAI Codex returned malformed additional rate limits');
    }
    for (const item of additional ?? []) {
        if (!isRecord(item))
            throw new Error('OpenAI Codex returned a malformed additional rate limit');
        const id = item['metered_feature'];
        const name = item['limit_name'];
        if (typeof id !== 'string' || id.length === 0) {
            throw new Error('OpenAI Codex returned an additional rate limit without an id');
        }
        if (name !== undefined && name !== null && typeof name !== 'string') {
            throw new Error('OpenAI Codex returned an invalid additional rate-limit name');
        }
        const limit = parseLimit(id, typeof name === 'string' && name.length > 0 ? name : undefined, item['rate_limit']);
        if (limit !== undefined)
            limits.push(limit);
    }
    const credits = parseCredits(value['credits']);
    const individualLimit = parseIndividualLimit(value['spend_control']);
    return {
        rateLimits: limits,
        ...credits === undefined ? {} : { credits },
        ...individualLimit === undefined ? {} : { individualLimit },
    };
}
/**
 * Read current quota without issuing a model request. OAuth is refreshed through
 * the same provider-native credential lifecycle used by normal Codex turns.
 * @param store - plugin-owned OAuth credential store.
 * @returns current rate-limit buckets safe to expose to the local browser page.
 */
export async function readOpenAICodexRateLimits(store, requestFetch = globalThis.fetch) {
    const models = createModels({ credentials: store });
    models.setProvider(openaiCodexProvider());
    const auth = await models.getAuth(OPENAI_CODEX_PROVIDER);
    const credential = await store.read(OPENAI_CODEX_PROVIDER);
    const access = auth?.auth.apiKey;
    const accountId = credential?.type === 'oauth' ? credential.accountId : undefined;
    if (access === undefined || access.length === 0 || typeof accountId !== 'string' || accountId.length === 0) {
        throw new Error('OpenAI Codex is signed out');
    }
    const response = await requestFetch(OPENAI_CODEX_USAGE_URL, {
        method: 'GET',
        redirect: 'error',
        headers: {
            authorization: `Bearer ${access}`,
            'chatgpt-account-id': accountId,
            accept: 'application/json',
            'cache-control': 'no-store',
            'user-agent': 'dsh-openai-codex',
        },
        signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new OpenAICodexReauthRequiredError();
        }
        throw new Error(`OpenAI Codex usage request failed with HTTP ${response.status}`);
    }
    let value;
    try {
        value = await response.json();
    }
    catch (error) {
        throw new Error('OpenAI Codex returned an unreadable usage response', { cause: error });
    }
    return parseOpenAICodexUsage(value);
}
//# sourceMappingURL=usage.js.map