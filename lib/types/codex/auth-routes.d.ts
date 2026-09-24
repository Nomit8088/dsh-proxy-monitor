/** Same-origin Web settings routes for OpenAI Codex OAuth. */
import type { IncomingMessage } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type { OpenAICodexCredentialStore } from "./store.js";
import { OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE } from "./usage.js";
import type { OpenAICodexUsage } from "./usage.js";
import { OpenAICodexTrustedOriginsStore } from "./trusted-origins.js";
import { FastModeRegistry } from "./fast-mode.js";
import type { ImageToolPolicy, ModelCatalogSettings } from "./tool-policy.js";
import type { ProxyPreferences } from "./proxy.js";
export { OPENAI_CODEX_AUTH_LOGIN_PATH, OPENAI_CODEX_AUTH_LOGOUT_PATH, OPENAI_CODEX_AUTH_STATUS_PATH, } from "./auth-paths.js";
export { OPENAI_CODEX_FAST_MODE_PATH } from "./fast-mode-paths.js";
/** Plugin-owned image-tool preference endpoint consumed by its browser half. */
export declare const OPENAI_CODEX_IMAGE_TOOL_SETTINGS_PATH = "/plugins/dsh-openai-codex/image-tools";
/** Plugin-owned Responses API experiment endpoint consumed by its browser half. */
export declare const OPENAI_CODEX_RESPONSE_API_SETTINGS_PATH = "/plugins/dsh-openai-codex/response-api";
/** Plugin-owned model discovery preference endpoint consumed by its browser half. */
export declare const OPENAI_CODEX_MODEL_CATALOG_SETTINGS_PATH = "/plugins/dsh-openai-codex/models";
/** Plugin-owned client-side context capacity endpoint consumed by its browser half. */
export declare const OPENAI_CODEX_CONTEXT_WINDOW_SETTINGS_PATH = "/plugins/dsh-openai-codex/context-window";
/** Plugin-owned Fast Mode default endpoint consumed by its browser half. */
export declare const OPENAI_CODEX_FAST_MODE_SETTINGS_PATH = "/plugins/dsh-openai-codex/fast-mode-default";
/** Plugin-owned proxy preference endpoint consumed by its browser half. */
export declare const OPENAI_CODEX_PROXY_SETTINGS_PATH = "/plugins/dsh-openai-codex/proxy";
/** Maximum time a browser request waits for the provider's authorization URL. */
export declare const OPENAI_CODEX_AUTH_URL_TIMEOUT_MS = 30000;
/** Stable, non-sensitive error returned when a browser origin needs CLI trust. */
export declare const REMOTE_WEB_ORIGIN_NOT_TRUSTED = "remote-web-origin-not-trusted";
export type OpenAICodexWebAuthStatus = {
    status: "signed-out";
} | {
    status: "signing-in";
} | {
    status: "reauth-required";
    message: typeof OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE;
} | {
    status: "signed-in";
    usage: OpenAICodexUsage;
    quotaError?: string;
} | {
    status: "error";
    message: string;
};
interface LoginChallenge {
    url: string;
}
/**
 * Maximum time one browser-login operation may stay pending. The OAuth
 * callback listener can otherwise wait forever (closed popup, callback lost
 * to another listener, or sign-in completed through a different front door),
 * which pins the public status at `signing-in` even when a valid credential
 * is already stored.
 */
export declare const OPENAI_CODEX_SIGN_IN_TIMEOUT_MS: number;
/** Testable timing boundaries for the authorization URL and complete callback flow. */
export interface OpenAICodexWebAuthOptions {
    challengeTimeoutMs?: number;
    signInTimeoutMs?: number;
    requestFetch?: typeof globalThis.fetch;
    beforeNetworkRequest?: () => Promise<void>;
}
/** One lifecycle owner for the callback server, challenge, and public status. */
export declare class OpenAICodexWebAuth {
    private readonly store;
    private state;
    private operation;
    private cancellation;
    private challenge;
    private challengeWaiters;
    private challengeTimer;
    private readonly challengeTimeoutMs;
    private readonly signInTimeoutMs;
    private readonly requestFetch;
    private readonly beforeNetworkRequest;
    constructor(store: OpenAICodexCredentialStore, options?: OpenAICodexWebAuthOptions);
    /** Read current public state, consulting durable storage while idle. */
    status(): Promise<OpenAICodexWebAuthStatus>;
    /** Start or join the current browser-login operation. */
    signIn(): Promise<LoginChallenge>;
    /** Cancel any callback listener, wait for quiescence, then delete the credential. */
    signOut(): Promise<void>;
    /** Stop the owned callback listener during plugin disposal. */
    dispose(): Promise<void>;
    private start;
    private onEvent;
    private readStoredStatus;
    private rejectChallenge;
    private clearChallengeTimer;
    private cancelSignIn;
}
export type TrustedRequestDecision = {
    trusted: true;
    error?: undefined;
} | {
    trusted: false;
    error: typeof REMOTE_WEB_ORIGIN_NOT_TRUSTED | "forbidden";
};
/** Evaluate one request against loopback defaults and the current sidecar. */
export declare function trustedRequestDecision(req: IncomingMessage, trustedOrigins?: OpenAICodexTrustedOriginsStore): Promise<TrustedRequestDecision>;
/** Whether a request is currently trusted; the sidecar is read on every call. */
export declare function trustedRequest(req: IncomingMessage, trustedOrigins?: OpenAICodexTrustedOriginsStore): Promise<boolean>;
export declare const OPENAI_CODEX_FAST_MODE_BODY_LIMIT = 4096;
interface ProxySettingsController {
    proxyPreferences(): ProxyPreferences;
    updateProxyPreferences(patch: Partial<ProxyPreferences>): Promise<ProxyPreferences>;
}
/** Register the plugin-owned OAuth routes when the Web server is composed. */
export declare function registerOpenAICodexAuthRoutes(ctx: Context, store: OpenAICodexCredentialStore, trustedOriginsOverride?: OpenAICodexTrustedOriginsStore, fastModeOverride?: FastModeRegistry, imageTools?: ImageToolPolicy, proxySettings?: ProxySettingsController, requestFetch?: typeof globalThis.fetch, beforeNetworkRequest?: () => Promise<void>, webAuthInstance?: OpenAICodexWebAuth, refreshModelCatalog?: () => Promise<ModelCatalogSettings>): OpenAICodexWebAuth;
