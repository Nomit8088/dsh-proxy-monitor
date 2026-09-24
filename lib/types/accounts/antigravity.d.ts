/**
 * Antigravity unified account adapter over FileCredentialStore and beginWebLogin.
 *
 * Implements AccountAdapter:
 * - account(): reads current credentials from FileCredentialStore and returns status.
 * - beginLogin(): starts loopback OAuth flow via beginWebLogin, returns authorization URL.
 * - pollLogin(): polls getWebLoginStatus() until complete, error, or cancelled.
 * - logout(): deletes credentials file and resets cached quota.
 * - quota(): reads from the shared snapshot.
 */
import type { ProviderQuota, QuotaSnapshot } from '../contract.js';
import type { AccountAdapter, LoginTicket, ProviderAccount, ProxiedProviderId } from './contract.js';
import { FileCredentialStore } from '../antigravity/index.js';
export declare class AntigravityAccountAdapter implements AccountAdapter {
    private readonly store;
    private readonly readSnapshot;
    readonly id: ProxiedProviderId;
    private currentTicketId;
    private ticketSeq;
    constructor(store: InstanceType<typeof FileCredentialStore> | undefined, readSnapshot: () => Promise<QuotaSnapshot>);
    account(): Promise<ProviderAccount>;
    beginLogin(): Promise<LoginTicket>;
    pollLogin(ticketId: string): Promise<LoginTicket>;
    logout(): Promise<void>;
    quota(): Promise<ProviderQuota>;
}
