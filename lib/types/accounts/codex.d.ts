/**
 * Codex unified account adapter over OpenAICodexCredentialStore and OpenAICodexWebAuth.
 *
 * Implements AccountAdapter:
 * - account(): reads current auth status and reports signed-in/signed-out, canLogout, canReauth.
 * - beginLogin(): starts browser OAuth flow, yields verification URL.
 * - pollLogin(): polls status until completed or cancelled.
 * - logout(): deletes stored OAuth credential.
 * - quota(): reads from the shared snapshot.
 */
import type { ProviderQuota, QuotaSnapshot } from '../contract.js';
import type { AccountAdapter, LoginTicket, ProviderAccount, ProxiedProviderId } from './contract.js';
import { OpenAICodexCredentialStore } from '../codex/store.js';
import { OpenAICodexWebAuth } from '../codex/auth-routes.js';
export declare class CodexAccountAdapter implements AccountAdapter {
    private readonly store;
    private readonly webAuth;
    private readonly readSnapshot;
    readonly id: ProxiedProviderId;
    private currentTicketId;
    private ticketSeq;
    constructor(store: OpenAICodexCredentialStore, webAuth: OpenAICodexWebAuth, readSnapshot: () => Promise<QuotaSnapshot>);
    account(): Promise<ProviderAccount>;
    beginLogin(): Promise<LoginTicket>;
    pollLogin(ticketId: string): Promise<LoginTicket>;
    logout(): Promise<void>;
    quota(): Promise<ProviderQuota>;
}
