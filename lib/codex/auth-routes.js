/** Same-origin Web settings routes for OpenAI Codex OAuth. */
import { dirname, join } from "node:path";
import { loginOpenAICodex, logoutOpenAICodex, openAICodexAuthStatus, } from "./auth.js";
import { isOpenAICodexReauthRequiredError, OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE, readOpenAICodexRateLimits, } from "./usage.js";
import { OPENAI_CODEX_AUTH_LOGIN_PATH, OPENAI_CODEX_AUTH_LOGOUT_PATH, OPENAI_CODEX_AUTH_STATUS_PATH, } from "./auth-paths.js";
import { OPENAI_CODEX_TRUSTED_ORIGINS_FILENAME, OpenAICodexTrustedOriginsStore, normalizeTrustedOrigin, } from "./trusted-origins.js";
import { FastModeRegistry, isFastModeSessionId } from "./fast-mode.js";
import { OPENAI_CODEX_FAST_MODE_PATH } from "./fast-mode-paths.js";
import { OPENAI_CODEX_CALLBACK_PORT, codexCallbackHost, startCodexCallbackBridge, } from "./loopback-bridge.js";
import { createServer } from "node:net";
export { OPENAI_CODEX_AUTH_LOGIN_PATH, OPENAI_CODEX_AUTH_LOGOUT_PATH, OPENAI_CODEX_AUTH_STATUS_PATH, } from "./auth-paths.js";
export { OPENAI_CODEX_FAST_MODE_PATH } from "./fast-mode-paths.js";
/** Plugin-owned image-tool preference endpoint consumed by its browser half. */
export const OPENAI_CODEX_IMAGE_TOOL_SETTINGS_PATH = "/plugins/dsh-openai-codex/image-tools";
/** Plugin-owned Responses API experiment endpoint consumed by its browser half. */
export const OPENAI_CODEX_RESPONSE_API_SETTINGS_PATH = "/plugins/dsh-openai-codex/response-api";
/** Plugin-owned model discovery preference endpoint consumed by its browser half. */
export const OPENAI_CODEX_MODEL_CATALOG_SETTINGS_PATH = "/plugins/dsh-openai-codex/models";
/** Plugin-owned client-side context capacity endpoint consumed by its browser half. */
export const OPENAI_CODEX_CONTEXT_WINDOW_SETTINGS_PATH = "/plugins/dsh-openai-codex/context-window";
/** Plugin-owned Fast Mode default endpoint consumed by its browser half. */
export const OPENAI_CODEX_FAST_MODE_SETTINGS_PATH = "/plugins/dsh-openai-codex/fast-mode-default";
/** Plugin-owned proxy preference endpoint consumed by its browser half. */
export const OPENAI_CODEX_PROXY_SETTINGS_PATH = "/plugins/dsh-openai-codex/proxy";
/** Maximum time a browser request waits for the provider's authorization URL. */
export const OPENAI_CODEX_AUTH_URL_TIMEOUT_MS = 30_000;
/** Stable, non-sensitive error returned when a browser origin needs CLI trust. */
export const REMOTE_WEB_ORIGIN_NOT_TRUSTED = "remote-web-origin-not-trusted";
/**
 * Maximum time one browser-login operation may stay pending. The OAuth
 * callback listener can otherwise wait forever (closed popup, callback lost
 * to another listener, or sign-in completed through a different front door),
 * which pins the public status at `signing-in` even when a valid credential
 * is already stored.
 */
export const OPENAI_CODEX_SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;
/** Redact provider diagnostics before they cross to the browser. */
function safeMessage(error) {
    return (error instanceof Error ? error.message : String(error))
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]")
        .replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]")
        .slice(0, 1000);
}
/**
 * Reject with the prompt's abort reason while browser callback owns completion.
 *
 * The provider's own prompt signal is authoritative for its flow, but it is not
 * ours: pi-ai's manual-code prompt carries a private controller that its
 * completion path aborts, and that path is exactly what a broken callback never
 * reaches. The caller's cancellation signal is therefore honoured here too, so a
 * cancelled or timed-out sign-in can never leave this promise — and with it the
 * whole operation — pending forever.
 *
 * @param prompt - the provider's prompt request.
 * @param cancelSignal - the sign-in operation's own cancellation signal.
 * @returns the entered value when the provider settles the prompt itself.
 */
function waitForPromptAbort(prompt, cancelSignal) {
    const signal = prompt.signal;
    if (signal === undefined && cancelSignal === undefined) {
        return new Promise(() => { });
    }
    if (signal?.aborted === true)
        return Promise.reject(signal.reason);
    if (cancelSignal?.aborted === true)
        return Promise.reject(cancelSignal.reason);
    return new Promise((_resolve, reject) => {
        const rejectWith = (reason) => {
            reject(reason);
        };
        signal?.addEventListener("abort", () => { rejectWith(signal.reason); }, { once: true });
        cancelSignal?.addEventListener("abort", () => { rejectWith(cancelSignal.reason); }, { once: true });
    });
}
/**
 * Whether one loopback address can be bound right now.
 *
 * Used to refuse a sign-in whose callback could never arrive: the provider owns
 * the callback listener and swallows its own bind failure, so a busy port would
 * otherwise start a flow that waits forever for a callback already served by
 * somebody else.
 *
 * @param host - loopback address the provider will bind.
 * @param port - callback port.
 * @returns false when the bind is refused.
 */
function loopbackPortAvailable(host, port) {
    return new Promise((resolve) => {
        const probe = createServer();
        probe.once("error", () => { resolve(false); });
        probe.listen(port, host, () => {
            probe.close(() => { resolve(true); });
        });
    });
}
/** One lifecycle owner for the callback server, challenge, and public status. */
export class OpenAICodexWebAuth {
    store;
    state = { status: "signed-out" };
    operation;
    cancellation;
    challenge;
    challengeWaiters = [];
    challengeTimer;
    /**
     * Bridge for the loopback family pi-ai did not bind, live while one sign-in
     * operation is in flight. See `loopback-bridge.ts` for why the callback port
     * needs both families to answer.
     */
    bridge;
    challengeTimeoutMs;
    signInTimeoutMs;
    requestFetch;
    beforeNetworkRequest;
    constructor(store, options = {}) {
        this.store = store;
        this.challengeTimeoutMs =
            options.challengeTimeoutMs ?? OPENAI_CODEX_AUTH_URL_TIMEOUT_MS;
        this.signInTimeoutMs =
            options.signInTimeoutMs ?? OPENAI_CODEX_SIGN_IN_TIMEOUT_MS;
        this.requestFetch = options.requestFetch ?? globalThis.fetch;
        this.beforeNetworkRequest = options.beforeNetworkRequest;
        if (!Number.isFinite(this.challengeTimeoutMs) ||
            this.challengeTimeoutMs <= 0) {
            throw new TypeError("OpenAI Codex auth URL timeout must be a positive finite number");
        }
        if (!Number.isFinite(this.signInTimeoutMs) || this.signInTimeoutMs <= 0) {
            throw new TypeError("OpenAI Codex sign-in timeout must be a positive finite number");
        }
    }
    /** Read current public state, consulting durable storage while idle. */
    async status() {
        if (this.operation !== undefined)
            return this.state;
        if (this.state.status === "error")
            return this.state;
        return this.readStoredStatus();
    }
    /** Start or join the current browser-login operation. */
    async signIn() {
        if (this.operation === undefined)
            this.start();
        if (this.challenge !== undefined)
            return this.challenge;
        return new Promise((resolve, reject) => {
            this.challengeWaiters.push({ resolve, reject });
        });
    }
    /** Cancel any callback listener, wait for quiescence, then delete the credential. */
    async signOut() {
        this.cancelSignIn(new Error("OpenAI Codex sign-in cancelled"));
        await this.operation?.catch(() => undefined);
        await logoutOpenAICodex(this.store);
        this.challenge = undefined;
        this.state = { status: "signed-out" };
    }
    /** Stop the owned callback listener during plugin disposal. */
    async dispose() {
        this.cancelSignIn(new Error("OpenAI Codex plugin disposed"));
        await this.operation?.catch(() => undefined);
    }
    start() {
        const cancellation = new AbortController();
        this.cancellation = cancellation;
        this.challenge = undefined;
        this.state = { status: "signing-in" };
        // pi-ai's redirect URI says `localhost`, which a browser may resolve to the
        // family pi-ai did not bind; the other family is bridged for the lifetime of
        // this operation (released in the settle chain below).
        this.bridge = startCodexCallbackBridge();
        this.challengeTimer = setTimeout(() => {
            this.cancelSignIn(new Error(`OpenAI Codex did not provide an authorization URL within ${String(this.challengeTimeoutMs)}ms`));
            this.detachOperation();
        }, this.challengeTimeoutMs);
        this.challengeTimer.unref();
        const signInTimer = setTimeout(() => {
            this.cancelSignIn(new Error("OpenAI Codex sign-in timed out waiting for the browser callback"));
            this.detachOperation();
        }, this.signInTimeoutMs);
        signInTimer.unref();
        const login = () => loginOpenAICodex({
            signal: cancellation.signal,
            prompt: (prompt) => prompt.type === "select"
                ? Promise.resolve("browser")
                : waitForPromptAbort(prompt, cancellation.signal),
            notify: (event) => {
                this.onEvent(event);
            },
        }, this.store);
        this.operation = (async () => {
            // The provider owns the callback listener and swallows its own bind
            // failure (it resolves a dead server and keeps going), which would leave a
            // flow waiting for a callback somebody else's listener is answering.
            // Refuse it here, where the reason can still be told to the user.
            const callbackHost = codexCallbackHost();
            if (!(await loopbackPortAvailable(callbackHost, OPENAI_CODEX_CALLBACK_PORT))) {
                throw new Error(`OpenAI Codex cannot receive its browser callback: ${callbackHost}:${String(OPENAI_CODEX_CALLBACK_PORT)} is already in use ` +
                    "(an earlier unfinished sign-in in this dsh process, or the Codex CLI). Restart `dsh web` and try again.");
            }
            await this.beforeNetworkRequest?.();
            await login();
        })()
            .then(async () => {
            if (this.challenge === undefined) {
                const error = new Error("OpenAI Codex sign-in finished without an authorization URL");
                this.rejectChallenge(error);
                this.state = { status: "error", message: safeMessage(error) };
                return;
            }
            this.state = await this.readStoredStatus();
        }, async (error) => {
            this.rejectChallenge(error);
            // A failed or abandoned browser flow must not mask a valid stored
            // credential: sign-in may have completed through another front door.
            try {
                const stored = await this.readStoredStatus();
                if (stored.status === "signed-in") {
                    this.state = stored;
                    return;
                }
            }
            catch {
                /* fall through to the original error */
            }
            this.state = { status: "error", message: safeMessage(error) };
        })
            .finally(() => {
            this.clearChallengeTimer();
            clearTimeout(signInTimer);
            this.bridge?.();
            this.bridge = undefined;
            this.operation = undefined;
            this.cancellation = undefined;
        });
    }
    onEvent(event) {
        if (event.type !== "auth_url")
            return;
        let url;
        try {
            url = new URL(event.url);
        }
        catch {
            const error = new Error("OpenAI returned an invalid authorization URL");
            this.cancelSignIn(error);
            return;
        }
        if (url.protocol !== "https:" ||
            url.username !== "" ||
            url.password !== "") {
            const error = new Error("OpenAI returned an unsafe authorization URL");
            this.cancelSignIn(error);
            return;
        }
        const challenge = { url: event.url };
        this.challenge = challenge;
        this.clearChallengeTimer();
        for (const waiter of this.challengeWaiters.splice(0))
            waiter.resolve(challenge);
    }
    async readStoredStatus() {
        await this.beforeNetworkRequest?.();
        const stored = await openAICodexAuthStatus(this.store);
        if (!stored.authenticated)
            return { status: "signed-out" };
        try {
            return {
                status: "signed-in",
                usage: await readOpenAICodexRateLimits(this.store, this.requestFetch),
            };
        }
        catch (error) {
            if (isOpenAICodexReauthRequiredError(error)) {
                return {
                    status: "reauth-required",
                    message: OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE,
                };
            }
            return {
                status: "signed-in",
                usage: { rateLimits: [] },
                quotaError: safeMessage(error),
            };
        }
    }
    rejectChallenge(error) {
        this.clearChallengeTimer();
        for (const waiter of this.challengeWaiters.splice(0))
            waiter.reject(error);
    }
    /**
     * Forget the in-flight operation so a later attempt starts a fresh flow.
     *
     * Cancellation only reaches the provider when it is already waiting on our
     * signal; a flow parked on a prompt of its own would keep the operation set
     * forever, and every later `signIn()` would then join a conversation that is
     * over — presenting as an endless "waiting for the authorization page" with no
     * error at all. The abandoned promise is left to settle on its own.
     */
    detachOperation() {
        this.operation = undefined;
        this.cancellation = undefined;
        this.challenge = undefined;
    }
    clearChallengeTimer() {
        if (this.challengeTimer === undefined)
            return;
        clearTimeout(this.challengeTimer);
        this.challengeTimer = undefined;
    }
    cancelSignIn(error) {
        this.rejectChallenge(error);
        this.cancellation?.abort(error);
    }
}
function loopbackHost(rawHost) {
    if (/[\\/@?#]/u.test(rawHost))
        return false;
    try {
        const parsed = new URL(`http://${rawHost}`);
        if (parsed.username !== "" ||
            parsed.password !== "" ||
            parsed.pathname !== "/" ||
            parsed.search !== "" ||
            parsed.hash !== "")
            return false;
        const bracketless = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
            ? parsed.hostname.slice(1, -1)
            : parsed.hostname;
        const hostname = bracketless.toLowerCase().replace(/\.$/u, "");
        return (hostname === "localhost" ||
            hostname.endsWith(".localhost") ||
            hostname === "127.0.0.1" ||
            hostname === "::1" ||
            hostname === "::ffff:127.0.0.1");
    }
    catch {
        return false;
    }
}
function exactOrigin(req, rawHost, rawOrigin) {
    try {
        const encrypted = req.socket
            .encrypted === true;
        const effective = normalizeTrustedOrigin(`${encrypted ? "https" : "http"}://${rawHost}`);
        return normalizeTrustedOrigin(rawOrigin) === effective;
    }
    catch {
        return false;
    }
}
function effectiveOrigin(req, rawHost) {
    try {
        const encrypted = req.socket
            .encrypted === true;
        return normalizeTrustedOrigin(`${encrypted ? "https" : "http"}://${rawHost}`);
    }
    catch {
        return undefined;
    }
}
function sameOriginMetadata(req, host) {
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    return typeof origin === "string" && exactOrigin(req, host, origin);
}
/** Evaluate one request against loopback defaults and the current sidecar. */
export async function trustedRequestDecision(req, trustedOrigins = new OpenAICodexTrustedOriginsStore()) {
    const remote = req.socket.remoteAddress;
    const localPeer = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    const fetchSite = req.headers["sec-fetch-site"];
    const crossSite = typeof fetchSite === "string"
        ? fetchSite.trim().toLowerCase() === "cross-site"
        : Array.isArray(fetchSite) &&
            fetchSite.some((value) => value.trim().toLowerCase() === "cross-site");
    if (crossSite)
        return { trusted: false, error: "forbidden" };
    const host = req.headers.host;
    if (typeof host !== "string")
        return { trusted: false, error: "forbidden" };
    const origin = effectiveOrigin(req, host);
    if (origin === undefined)
        return { trusted: false, error: "forbidden" };
    if (!sameOriginMetadata(req, host))
        return { trusted: false, error: "forbidden" };
    if (localPeer && loopbackHost(host))
        return { trusted: true };
    try {
        if (await trustedOrigins.has(origin))
            return { trusted: true };
    }
    catch {
        // A malformed or too-broad sidecar fails closed without exposing contents.
        return { trusted: false, error: "forbidden" };
    }
    return {
        trusted: false,
        error: REMOTE_WEB_ORIGIN_NOT_TRUSTED,
    };
}
/** Whether a request is currently trusted; the sidecar is read on every call. */
export async function trustedRequest(req, trustedOrigins) {
    return (await trustedRequestDecision(req, trustedOrigins)).trusted;
}
function json(res, status, value) {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(value));
}
export const OPENAI_CODEX_FAST_MODE_BODY_LIMIT = 4_096;
function header(req, name) {
    const value = req.headers[name];
    if (Array.isArray(value))
        return value[0];
    return value;
}
function contentLength(req) {
    const raw = header(req, "content-length");
    if (raw === undefined)
        return undefined;
    if (!/^\d+$/u.test(raw.trim()))
        throw new TypeError("Fast Mode request content length is invalid");
    const value = Number(raw);
    if (!Number.isSafeInteger(value))
        throw new TypeError("Fast Mode request content length is invalid");
    return value;
}
/** Collect one small JSON body without exposing or logging its contents. */
async function readFastModeBody(req) {
    const declared = contentLength(req);
    if (declared !== undefined &&
        (!Number.isFinite(declared) || declared > OPENAI_CODEX_FAST_MODE_BODY_LIMIT)) {
        throw new RangeError("Fast Mode request body is too large");
    }
    const chunks = [];
    let total = 0;
    const iterable = req;
    if (typeof req[Symbol.asyncIterator] === "function") {
        for await (const chunk of iterable) {
            const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
            total += bytes.byteLength;
            if (total > OPENAI_CODEX_FAST_MODE_BODY_LIMIT)
                throw new RangeError("Fast Mode request body is too large");
            chunks.push(bytes);
        }
    }
    else {
        const body = req.body;
        if (typeof body === "string") {
            const bytes = Buffer.from(body);
            if (bytes.byteLength > OPENAI_CODEX_FAST_MODE_BODY_LIMIT)
                throw new RangeError("Fast Mode request body is too large");
            chunks.push(bytes);
        }
        else if (body instanceof Uint8Array) {
            if (body.byteLength > OPENAI_CODEX_FAST_MODE_BODY_LIMIT)
                throw new RangeError("Fast Mode request body is too large");
            chunks.push(new Uint8Array(body));
        }
        else if (body !== undefined) {
            throw new TypeError("Fast Mode request body is invalid");
        }
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    if (bytes.byteLength === 0)
        throw new TypeError("Fast Mode request body is invalid");
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        throw new TypeError("Fast Mode request body is invalid");
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new TypeError("Fast Mode request body is invalid");
    }
}
function fastModeSessionIdFromQuery(req) {
    const rawUrl = req.url;
    if (typeof rawUrl !== "string")
        return undefined;
    try {
        const url = new URL(rawUrl, "http://dsh.invalid");
        const values = url.searchParams.getAll("sessionId");
        return values.length === 1 && isFastModeSessionId(values[0])
            ? values[0]
            : undefined;
    }
    catch {
        return undefined;
    }
}
function fastModeBody(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return undefined;
    const record = value;
    if (Object.keys(record).length !== 2)
        return undefined;
    const sessionId = record["sessionId"];
    const enabled = record["enabled"];
    return isFastModeSessionId(sessionId) && typeof enabled === "boolean"
        ? { sessionId, enabled }
        : undefined;
}
async function readSettingsBody(req) {
    const value = await readFastModeBody(req);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError("request body must be an object");
    }
    return value;
}
function imagePreferencePatch(value) {
    const allowed = new Set([
        "modifyReadImage",
        "shareImagegenWithOtherModels",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new TypeError("request contains an unknown image-tool setting");
    }
    const patch = {};
    for (const key of allowed) {
        if (value[key] === undefined)
            continue;
        if (typeof value[key] !== "boolean")
            throw new TypeError(`${key} must be a boolean`);
        patch[key] = value[key];
    }
    return patch;
}
function responseApiPatch(value) {
    const allowed = new Set([
        "useWebSocketContextReuse",
        "useNativeCompaction",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new TypeError("request contains an unknown Responses API setting");
    }
    const patch = {};
    for (const key of allowed) {
        if (value[key] === undefined)
            continue;
        if (typeof value[key] !== "boolean")
            throw new TypeError(`${key} must be a boolean`);
        patch[key] = value[key];
    }
    return patch;
}
function contextWindowPatch(value) {
    const allowed = new Set([
        "contextWindow",
        "overrideSparkContextWindow",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new TypeError("request contains an unknown context-window setting");
    }
    const patch = {};
    const contextWindow = value["contextWindow"];
    if (contextWindow !== undefined) {
        if (contextWindow !== null &&
            (typeof contextWindow !== "number" ||
                !Number.isSafeInteger(contextWindow) ||
                contextWindow <= 0)) {
            throw new TypeError("contextWindow must be a positive safe integer or null");
        }
        patch.contextWindow = contextWindow;
    }
    const overrideSparkContextWindow = value["overrideSparkContextWindow"];
    if (overrideSparkContextWindow !== undefined) {
        if (typeof overrideSparkContextWindow !== "boolean") {
            throw new TypeError("overrideSparkContextWindow must be a boolean");
        }
        patch.overrideSparkContextWindow = overrideSparkContextWindow;
    }
    return patch;
}
function modelCatalogPatch(value) {
    const allowed = new Set(["models", "imageModels"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new TypeError("request contains an unknown model setting");
    }
    const patch = {};
    const models = value["models"];
    if (models !== undefined) {
        if (!Array.isArray(models) ||
            models.some((model) => typeof model !== "string")) {
            throw new TypeError("models must be an array of strings");
        }
        patch.models = models;
    }
    const imageModels = value["imageModels"];
    if (imageModels !== undefined) {
        if (!Array.isArray(imageModels) ||
            imageModels.some((model) => typeof model !== "string")) {
            throw new TypeError("imageModels must be an array of strings");
        }
        patch.imageModels = imageModels;
    }
    if (patch.models === undefined && patch.imageModels === undefined) {
        throw new TypeError("models or imageModels must be an array of strings");
    }
    return patch;
}
function fastModeSettingsPatch(value) {
    const allowed = new Set(["fastModeDefault"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new TypeError("request contains an unknown Fast Mode setting");
    }
    const patch = {};
    for (const key of allowed) {
        if (value[key] === undefined)
            continue;
        if (typeof value[key] !== "boolean")
            throw new TypeError(`${key} must be a boolean`);
        patch[key] = value[key];
    }
    return patch;
}
function proxyPreferencePatch(value) {
    const allowed = new Set([
        "proxyMode",
        "proxyUrl",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new TypeError("request contains an unknown proxy setting");
    }
    const patch = {};
    const proxyMode = value["proxyMode"];
    if (proxyMode !== undefined) {
        if (proxyMode !== "off" &&
            proxyMode !== "scoped" &&
            proxyMode !== "global") {
            throw new TypeError("proxyMode must be off, scoped, or global");
        }
        patch.proxyMode = proxyMode;
    }
    const proxyUrl = value["proxyUrl"];
    if (proxyUrl !== undefined) {
        if (typeof proxyUrl !== "string") {
            throw new TypeError("proxyUrl must be a string");
        }
        patch.proxyUrl = proxyUrl;
    }
    return patch;
}
/** Register the plugin-owned OAuth routes when the Web server is composed. */
export function registerOpenAICodexAuthRoutes(ctx, store, trustedOriginsOverride, fastModeOverride, imageTools, proxySettings, requestFetch, beforeNetworkRequest, webAuthInstance, refreshModelCatalog) {
    const auth = webAuthInstance ??
        new OpenAICodexWebAuth(store, {
            ...(requestFetch === undefined ? {} : { requestFetch }),
            ...(beforeNetworkRequest === undefined ? {} : { beforeNetworkRequest }),
        });
    const storedFilename = store.filename;
    const fastMode = fastModeOverride ?? new FastModeRegistry();
    const trustedOrigins = trustedOriginsOverride ??
        (typeof storedFilename === "string"
            ? new OpenAICodexTrustedOriginsStore(join(dirname(storedFilename), OPENAI_CODEX_TRUSTED_ORIGINS_FILENAME))
            : new OpenAICodexTrustedOriginsStore());
    ctx.effect(() => {
        const authorize = async (req, res) => {
            const decision = await trustedRequestDecision(req, trustedOrigins);
            if (decision.trusted)
                return true;
            json(res, 403, { error: decision.error });
            return false;
        };
        const routes = [
            ctx.webServer.register({
                kind: "exact",
                path: OPENAI_CODEX_AUTH_STATUS_PATH,
                handler: async (req, res) => {
                    if (req.method !== "GET")
                        return json(res, 405, { error: "method not allowed" });
                    if (!(await authorize(req, res)))
                        return;
                    json(res, 200, await auth.status());
                },
            }),
            ctx.webServer.register({
                kind: "exact",
                path: OPENAI_CODEX_AUTH_LOGIN_PATH,
                handler: async (req, res) => {
                    if (req.method !== "POST")
                        return json(res, 405, { error: "method not allowed" });
                    if (!(await authorize(req, res)))
                        return;
                    try {
                        json(res, 200, await auth.signIn());
                    }
                    catch (error) {
                        json(res, 500, { error: safeMessage(error) });
                    }
                },
            }),
            ctx.webServer.register({
                kind: "exact",
                path: OPENAI_CODEX_AUTH_LOGOUT_PATH,
                handler: async (req, res) => {
                    if (req.method !== "POST")
                        return json(res, 405, { error: "method not allowed" });
                    if (!(await authorize(req, res)))
                        return;
                    try {
                        await auth.signOut();
                        json(res, 200, { ok: true });
                    }
                    catch (error) {
                        json(res, 500, { error: safeMessage(error) });
                    }
                },
            }),
            ctx.webServer.register({
                kind: "exact",
                path: OPENAI_CODEX_FAST_MODE_PATH,
                handler: async (req, res) => {
                    if (req.method !== "GET" && req.method !== "POST")
                        return json(res, 405, { error: "method not allowed" });
                    if (!(await authorize(req, res)))
                        return;
                    if (req.method === "GET") {
                        const sessionId = fastModeSessionIdFromQuery(req);
                        if (sessionId === undefined)
                            return json(res, 400, { error: "invalid input" });
                        return json(res, 200, {
                            enabled: imageTools?.fastModeSnapshot().fastModeDefault === true ||
                                fastMode.isEnabled(sessionId),
                        });
                    }
                    const type = header(req, "content-type");
                    if (type === undefined ||
                        !/^application\/json(?:\s*;|$)/iu.test(type.trim())) {
                        return json(res, 415, { error: "unsupported content type" });
                    }
                    try {
                        const body = fastModeBody(await readFastModeBody(req));
                        if (body === undefined)
                            return json(res, 400, { error: "invalid input" });
                        fastMode.set(body.sessionId, body.enabled);
                        return json(res, 200, {
                            enabled: fastMode.isEnabled(body.sessionId),
                        });
                    }
                    catch (error) {
                        return json(res, error instanceof RangeError ? 413 : 400, {
                            error: error instanceof RangeError
                                ? "request body too large"
                                : "invalid input",
                        });
                    }
                },
            }),
            ...(imageTools === undefined
                ? []
                : [
                    ctx.webServer.register({
                        kind: "exact",
                        path: OPENAI_CODEX_IMAGE_TOOL_SETTINGS_PATH,
                        handler: async (req, res) => {
                            if (!(await authorize(req, res)))
                                return;
                            if (req.method === "GET")
                                return json(res, 200, imageTools.snapshot());
                            if (req.method !== "POST")
                                return json(res, 405, { error: "method not allowed" });
                            try {
                                return json(res, 200, await imageTools.update(imagePreferencePatch(await readSettingsBody(req))));
                            }
                            catch (error) {
                                return json(res, 400, { error: safeMessage(error) });
                            }
                        },
                    }),
                    ctx.webServer.register({
                        kind: "exact",
                        path: OPENAI_CODEX_RESPONSE_API_SETTINGS_PATH,
                        handler: async (req, res) => {
                            if (!(await authorize(req, res)))
                                return;
                            if (req.method === "GET")
                                return json(res, 200, imageTools.responseApiSnapshot());
                            if (req.method !== "POST")
                                return json(res, 405, { error: "method not allowed" });
                            try {
                                return json(res, 200, await imageTools.updateResponseApi(responseApiPatch(await readSettingsBody(req))));
                            }
                            catch (error) {
                                return json(res, 400, { error: safeMessage(error) });
                            }
                        },
                    }),
                    ctx.webServer.register({
                        kind: "exact",
                        path: OPENAI_CODEX_CONTEXT_WINDOW_SETTINGS_PATH,
                        handler: async (req, res) => {
                            if (!(await authorize(req, res)))
                                return;
                            if (req.method === "GET")
                                return json(res, 200, imageTools.contextWindowSnapshot());
                            if (req.method !== "POST")
                                return json(res, 405, { error: "method not allowed" });
                            try {
                                return json(res, 200, await imageTools.updateContextWindow(contextWindowPatch(await readSettingsBody(req))));
                            }
                            catch (error) {
                                return json(res, 400, { error: safeMessage(error) });
                            }
                        },
                    }),
                    ctx.webServer.register({
                        kind: "exact",
                        path: OPENAI_CODEX_MODEL_CATALOG_SETTINGS_PATH,
                        handler: async (req, res) => {
                            if (!(await authorize(req, res)))
                                return;
                            if (req.method === "GET")
                                return json(res, 200, imageTools.modelCatalogSnapshot());
                            if (req.method !== "POST")
                                return json(res, 405, { error: "method not allowed" });
                            try {
                                const body = await readSettingsBody(req);
                                if (body["refresh"] === true) {
                                    if (refreshModelCatalog === undefined) {
                                        return json(res, 200, imageTools.modelCatalogSnapshot());
                                    }
                                    const refreshed = await refreshModelCatalog();
                                    try {
                                        ctx.emit("llm/adapters-updated");
                                    }
                                    catch {
                                        /* route announce is best-effort */
                                    }
                                    return json(res, 200, refreshed);
                                }
                                const next = await imageTools.updateModelCatalog(modelCatalogPatch(body));
                                try {
                                    ctx.emit("llm/adapters-updated");
                                }
                                catch {
                                    /* route announce is best-effort */
                                }
                                return json(res, 200, next);
                            }
                            catch (error) {
                                return json(res, 400, { error: safeMessage(error) });
                            }
                        },
                    }),
                    ctx.webServer.register({
                        kind: "exact",
                        path: OPENAI_CODEX_FAST_MODE_SETTINGS_PATH,
                        handler: async (req, res) => {
                            if (!(await authorize(req, res)))
                                return;
                            if (req.method === "GET")
                                return json(res, 200, imageTools.fastModeSnapshot());
                            if (req.method !== "POST")
                                return json(res, 405, { error: "method not allowed" });
                            try {
                                return json(res, 200, await imageTools.updateFastMode(fastModeSettingsPatch(await readSettingsBody(req))));
                            }
                            catch (error) {
                                return json(res, 400, { error: safeMessage(error) });
                            }
                        },
                    }),
                ]),
            ...(proxySettings === undefined
                ? []
                : [
                    ctx.webServer.register({
                        kind: "exact",
                        path: OPENAI_CODEX_PROXY_SETTINGS_PATH,
                        handler: async (req, res) => {
                            if (!(await authorize(req, res)))
                                return;
                            if (req.method === "GET") {
                                return json(res, 200, proxySettings.proxyPreferences());
                            }
                            if (req.method !== "POST") {
                                return json(res, 405, { error: "method not allowed" });
                            }
                            try {
                                return json(res, 200, await proxySettings.updateProxyPreferences(proxyPreferencePatch(await readSettingsBody(req))));
                            }
                            catch (error) {
                                return json(res, 400, { error: safeMessage(error) });
                            }
                        },
                    }),
                ]),
        ];
        return async () => {
            for (const dispose of routes)
                dispose();
            await auth.dispose();
        };
    }, "dsh-openai-codex: Web OAuth routes");
    return auth;
}
//# sourceMappingURL=auth-routes.js.map