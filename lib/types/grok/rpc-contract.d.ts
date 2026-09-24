/** Browser-safe dedicated Connection RPC contract owned by grok-auth. */
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection';
/** Logical channel registered by the plugin's Host half and called by its browser half. */
export declare const GROK_AUTH_RPC_CHANNEL = "/grok-auth";
/**
 * One login flow: `browser` spawns the official `grok login` CLI flow;
 * `device` runs the RFC 8628 device-code flow inside the Host and surfaces
 * the user code through this channel.
 */
export type GrokAuthLoginMode = 'browser' | 'device';
/** A pending device-code login awaiting approval; token values are intentionally absent. */
export interface GrokPendingLoginView {
    userCode: string;
    verificationUri: string;
    /** ISO timestamp after which the device code is dead. */
    expiresAt: string;
}
/** Value-free login state; token values are intentionally absent. */
export interface GrokAuthStatusView {
    available: boolean;
    configured: boolean;
    authMode?: string;
    grokVersion?: string;
    tokenExpiresAt?: string;
    /** ISO timestamp the current token set was issued/refreshed, when recorded. */
    createdAt?: string;
    /** Account email recorded by the official CLI; an identity fact, never a credential. */
    email?: string;
    credentialRef: string;
    authFileExists: boolean;
    /** Present while a Host-run device-code login awaits approval. */
    pendingLogin?: GrokPendingLoginView;
    /** Last device-login failure, when one is worth showing; cleared by the next attempt. */
    lastLoginError?: string;
}
/** Value-free weekly usage snapshot for the settings login block. */
export interface GrokUsageView {
    /** Remaining percentage (0-100) of the weekly subscription credit window; absent when unknown. */
    weeklyRemainingPercent?: number;
    /** ISO timestamp of the weekly window's next reset; absent when unknown. */
    weeklyResetAt?: string;
}
/** Reply to one login request; device mode carries the code to show the user. */
export interface GrokLoginStartView {
    started: boolean;
    userCode?: string;
    verificationUri?: string;
    expiresInSeconds?: number;
}
/** Browser-safe face consumed by the settings card. */
export interface GrokAuthRpcClient {
    /** Read the value-free Grok login state. */
    status(signal?: AbortSignal): Promise<ConnectionRpcResult<{
        status: GrokAuthStatusView;
    }>>;
    /** Read the value-free weekly usage snapshot from the Grok backend. */
    usage(signal?: AbortSignal): Promise<ConnectionRpcResult<{
        usage: GrokUsageView;
    }>>;
    /** Start one login flow. */
    login(mode: GrokAuthLoginMode, signal?: AbortSignal): Promise<ConnectionRpcResult<{
        login: GrokLoginStartView;
    }>>;
}
/** Minimal generic Connection caller required by this plugin. */
export interface GrokAuthConnectionRpc {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<ConnectionRpcResult<unknown>>;
}
/** Build the browser face over Connection's plugin-owned unary channel. */
export declare function createGrokAuthRpcClient(rpc: GrokAuthConnectionRpc): GrokAuthRpcClient;
