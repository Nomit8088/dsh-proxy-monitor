/**
 * OpenAI Codex standalone web search over the dsh web provider seam.
 * @module dsh-codex/search
 */
import { createModels } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { WebError } from '@deepseek-ai/dsh-web';
import { OPENAI_CODEX_PROVIDER } from './store.js';
/** Stable dsh web-provider id selected by the bundle patch. */
export const OPENAI_CODEX_SEARCH_PROVIDER = OPENAI_CODEX_PROVIDER;
/** Trusted first-party Codex base; OAuth credentials never cross to a configured origin. */
export const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
/** Standalone search endpoint used by the official Codex client. */
export const OPENAI_CODEX_SEARCH_URL = `${OPENAI_CODEX_BASE_URL}/alpha/search`;
/** Default model used by the standalone search endpoint. */
export const DEFAULT_OPENAI_CODEX_SEARCH_MODEL = 'gpt-5.6-sol';
/** Default search mode, matching the official local Codex client. */
export const DEFAULT_OPENAI_CODEX_SEARCH_MODE = 'cached';
/** Default provider search-context size. */
export const DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE = 'medium';
/** Default output budget for the standalone search response. */
export const DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS = 10_000;
/** Convert the configured mode to the official endpoint field. */
function externalWebAccess(mode) {
    switch (mode) {
        case 'cached': return false;
        case 'indexed': return 'indexed';
        case 'live': return true;
    }
}
/** Extract the account id paired with one OAuth access token. */
function accountIdFromToken(access) {
    try {
        const parts = access.split('.');
        if (parts.length !== 3 || parts[1] === undefined)
            throw new Error('invalid JWT');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const auth = payload['https://api.openai.com/auth'];
        if (typeof auth !== 'object' || auth === null || Array.isArray(auth))
            throw new Error('missing auth claim');
        const accountId = auth['chatgpt_account_id'];
        if (typeof accountId !== 'string' || accountId.length === 0)
            throw new Error('missing account id');
        return accountId;
    }
    catch (error) {
        throw new WebError('OpenAI Codex search credential has no usable account id; run "dsh openai-codex login" again', 'WEB_PROVIDER_CREDENTIAL_MISSING', { cause: error });
    }
}
/** Whether an opaque value is a non-array record. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Read an optional non-empty string field. */
function optionalString(record, key) {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
/** Accept only citeable HTTP(S) URLs from opaque result DTOs. */
function citeableUrl(value) {
    if (typeof value !== 'string')
        return undefined;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Map the standalone endpoint's forward-compatible result DTOs into the dsh
 * web result. Unknown DTO types and fields are ignored; malformed envelope
 * fields fail at the network boundary.
 * @param value - parsed response JSON.
 * @returns normalized answer and citeable sources.
 */
export function mapOpenAICodexSearchResponse(value) {
    if (!isRecord(value) || typeof value['output'] !== 'string') {
        throw new WebError('OpenAI Codex returned a search response without string output', 'WEB_PROVIDER_ERROR');
    }
    const output = value['output'];
    const rawResults = value['results'];
    if (rawResults !== undefined && !Array.isArray(rawResults)) {
        throw new WebError('OpenAI Codex returned a search response with non-array results', 'WEB_PROVIDER_ERROR');
    }
    const sources = [];
    const seen = new Set();
    for (const item of rawResults ?? []) {
        if (!isRecord(item) || item['type'] !== 'text_result')
            continue;
        const url = citeableUrl(item['url']);
        if (url === undefined || seen.has(url))
            continue;
        seen.add(url);
        const title = optionalString(item, 'title');
        const snippet = optionalString(item, 'snippet');
        sources.push({
            url,
            ...title === undefined ? {} : { title },
            ...snippet === undefined ? {} : { snippet },
        });
    }
    return {
        ...output.length === 0 ? {} : { content: output },
        sources,
        truncated: false,
    };
}
/** Stable cancellation error for every provider phase. */
function searchAborted(signal, fallback) {
    return new WebError('OpenAI Codex search aborted', 'WEB_ABORTED', {
        cause: signal?.aborted === true ? signal.reason : fallback,
    });
}
/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
    if (signal?.aborted === true)
        throw searchAborted(signal);
}
/** True for native fetch cancellation. */
function isAbortError(error) {
    return error instanceof DOMException && error.name === 'AbortError';
}
/** Race an asynchronous auth refresh against caller cancellation. */
function abortable(operation, signal) {
    if (signal === undefined)
        return operation;
    if (signal.aborted)
        return Promise.reject(searchAborted(signal));
    return new Promise((resolve, reject) => {
        const onAbort = () => { reject(searchAborted(signal)); };
        signal.addEventListener('abort', onAbort, { once: true });
        void operation.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}
/** Keep provider diagnostics bounded and remove JWT-like material. */
function providerMessage(value) {
    if (!isRecord(value))
        return undefined;
    const error = value['error'];
    const raw = typeof error === 'string'
        ? error
        : isRecord(error) && typeof error['message'] === 'string'
            ? error['message']
            : typeof value['message'] === 'string' ? value['message'] : undefined;
    return raw?.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[REDACTED]').slice(0, 1000);
}
/** OpenAI Codex standalone-search provider using the same refreshable OAuth store as the LLM route. */
export class OpenAICodexSearchProvider {
    options;
    id = OPENAI_CODEX_SEARCH_PROVIDER;
    models;
    /**
     * @param options - fixed trusted endpoint policy and deployment tunables.
     */
    constructor(options) {
        this.options = options;
        const models = createModels({ credentials: options.credentials });
        models.setProvider(openaiCodexProvider());
        this.models = models;
    }
    /** The local configuration is usable; credential presence is resolved per request. */
    available() {
        return this.options.model.length > 0
            && Number.isInteger(this.options.maxOutputTokens)
            && this.options.maxOutputTokens > 0;
    }
    /** @inheritdoc */
    async search(request, signal) {
        throwIfSearchAborted(signal);
        let auth;
        try {
            auth = await abortable(this.models.getAuth(OPENAI_CODEX_PROVIDER), signal);
        }
        catch (error) {
            throwIfSearchAborted(signal);
            if (isAbortError(error))
                throw searchAborted(signal, error);
            throw new WebError('OpenAI Codex search credential resolution failed', 'WEB_PROVIDER_ERROR', { cause: error });
        }
        const access = auth?.auth.apiKey;
        if (access === undefined || access.length === 0) {
            throw new WebError('OpenAI Codex search is signed out; run "dsh openai-codex login"', 'WEB_PROVIDER_CREDENTIAL_MISSING');
        }
        const accountId = accountIdFromToken(access);
        throwIfSearchAborted(signal);
        const body = {
            id: this.options.resolveRequestId(),
            model: this.options.model,
            input: [{
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: request.query }],
                }],
            commands: { search_query: [{ q: request.query }] },
            settings: {
                search_context_size: this.options.contextSize,
                allowed_callers: ['direct'],
                external_web_access: externalWebAccess(this.options.mode),
            },
            max_output_tokens: this.options.maxOutputTokens,
        };
        this.options.recordRequest?.({ endpoint: OPENAI_CODEX_SEARCH_URL, body });
        throwIfSearchAborted(signal);
        let response;
        try {
            response = await (this.options.fetch ?? globalThis.fetch)(OPENAI_CODEX_SEARCH_URL, {
                method: 'POST',
                redirect: 'error',
                headers: {
                    authorization: `Bearer ${access}`,
                    'chatgpt-account-id': accountId,
                    'content-type': 'application/json',
                    accept: 'application/json',
                    originator: 'deepseek-harness',
                },
                body: JSON.stringify(body),
                ...signal === undefined ? {} : { signal },
            });
        }
        catch (error) {
            throwIfSearchAborted(signal);
            if (isAbortError(error))
                throw searchAborted(signal, error);
            throw new WebError('OpenAI Codex search request failed', 'WEB_PROVIDER_ERROR', { cause: error });
        }
        let payload;
        try {
            payload = await response.json();
        }
        catch (error) {
            throwIfSearchAborted(signal);
            if (isAbortError(error))
                throw searchAborted(signal, error);
            throw new WebError(`OpenAI Codex returned an unprocessable search response (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR', { cause: error });
        }
        if (!response.ok) {
            const detail = providerMessage(payload);
            const message = detail === undefined
                ? `OpenAI Codex search failed (HTTP ${response.status})`
                : `OpenAI Codex search failed (HTTP ${response.status}): ${detail}`;
            throw new WebError(response.status === 401 || response.status === 403
                ? `${message}; run "dsh openai-codex login" again`
                : message, response.status === 401 || response.status === 403
                ? 'WEB_PROVIDER_CREDENTIAL_MISSING'
                : 'WEB_PROVIDER_ERROR');
        }
        return mapOpenAICodexSearchResponse(payload);
    }
}
//# sourceMappingURL=search.js.map