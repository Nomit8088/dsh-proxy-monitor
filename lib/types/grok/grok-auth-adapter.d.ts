/**
 * The LLM adapter half of the grok-auth plugin: registers the `xai` route
 * with a pi-ai-backed adapter that resolves the xAI OAuth access token from
 * the live Grok CLI auth file (refreshing through the official auth.x.ai
 * endpoint when it is about to expire) instead of through the credentials
 * seam — which is single-provider by design and cannot be extended from a
 * plugin.
 *
 * Everything provider-specific — the api.x.ai OpenAI-compatible protocols,
 * tool calls, streaming, the model catalog — is the installed pi-ai `xai`
 * provider, wrapped by the harness's own `PiAiAdapter`; this package only
 * supplies the credential and the route. A subscription OAuth access token is
 * accepted by api.x.ai as a Bearer credential (the same construction pi-ai's
 * own xAI subscription login uses), so the request-level `apiKey` override is
 * the entire integration.
 *
 * @module dsh-grok-auth/grok-auth-adapter
 */
import type { AuthContext, CredentialStore } from '@earendil-works/pi-ai';
import type { Context } from '@deepseek-ai/cordis';
import type { CredentialRef } from '@deepseek-ai/dsh-credentials';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { GrokModelCatalog } from './grok-models.js';
import type { GrokAuthService } from './grok-auth-service.js';
/** The provider route this adapter registers (the installed pi-ai catalog id). */
export declare const GROK_ROUTE = "xai";
/** Default request timeout for the route. */
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
/** llm-pi-ai's default maximum encoded image payload for one pi-ai request. */
export declare const MAX_REQUEST_IMAGE_BYTES: number;
/**
 * Grok owns authentication in the Host-side coordinator and injects its token
 * through `resolveApiKey` for each request. Pi-ai's login/storage surface must
 * therefore remain deliberately inert: allowing it to discover or persist a
 * second credential (an ambient XAI_API_KEY, its own subscription login)
 * would break the single-source and secret-boundary rules.
 */
export declare function grokAuthInjection(): {
    credentials: CredentialStore;
    authContext: AuthContext;
};
/** Options one adapter instance is constructed with. */
export interface GrokAuthAdapterOptions {
    /** Shared Host-only coordinator used by every authenticated operation. */
    auth: Pick<GrokAuthService, 'credential'>;
    /** The credential reference the status card advertises. */
    credentialRef: CredentialRef;
    /** Selector label for the route. */
    displayName: string;
    /** Endpoint override; empty keeps the installed catalog's api.x.ai endpoint. */
    baseUrl: string;
    /** Request timeout in milliseconds; zero disables it. */
    timeoutMs: number;
    /** Overlay the installed catalog with the account's live model listing. */
    liveModels: boolean;
    /** Observe live discovery changing the model set (used to re-announce the route). */
    onCatalogChange?: (() => void) | undefined;
    /** Injectable transport for the live listing; defaults to the Host's fetch. */
    fetchImpl?: typeof fetch;
    /** Shared live catalog; when omitted a private instance is created when liveModels is on. */
    catalog?: GrokModelCatalog;
    /** Enabled model ids for the DSH selector; omitted means advertise every catalog row. */
    visibleModelIds?: () => readonly string[] | undefined;
    /** Models that declare image input so DSH will not intercept attachments. */
    imageModelIds?: () => readonly string[] | undefined;
}
/**
 * The grok-auth LLM adapter: one fixed `xai` profile over the installed
 * pi-ai provider, with the credential resolved from the Grok auth file per
 * request.
 */
export declare class GrokAuthAdapter extends PiAiAdapter {
    private readonly visibleModelIds;
    constructor(ctx: Context, options: GrokAuthAdapterOptions);
    listModels(provider: string): Promise<readonly import("@deepseek-ai/dsh-llm").LlmModelInfo[]>;
}
