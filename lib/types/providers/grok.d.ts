/**
 * xAI Grok (SuperGrok / X Premium subscription) usage adapter.
 *
 * dsh-grok-auth reads the official Grok CLI's auth document
 * (`~/.grok/auth.json`) and exposes the account's weekly credit usage through
 * its `grokAuth` cordis service and a plugin-owned Connection RPC channel.
 * That channel is browser-authenticated (`authority: loopback`) and not
 * callable with a plain server-side fetch, so this adapter reads the *same*
 * auth document directly and calls the same read-only billing endpoint the
 * sibling plugin uses:
 *
 * `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`
 *
 * The entry key is the OAuth access token (`key`, with `access_token` as the
 * legacy alias), and the selected entry matches the Grok CLI client id so a
 * multi-account document resolves the same row the CLI itself would.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/grok
 */
import type { ProviderQuota } from '../contract.js';
import { type ProviderContext } from './util.js';
/**
 * Read the Grok weekly credit position.
 *
 * The upstream reports `creditUsagePercent` (consumed) inside a `config`
 * envelope, plus the current period. A weekly period with no percentage means
 * an untouched window, which reads as 0% used rather than unknown.
 *
 * @param ctx - host-provided deps.
 * @returns the provider snapshot.
 */
export declare function readGrok(ctx: ProviderContext): Promise<ProviderQuota>;
/**
 * Convert a remaining-percent reading into the consumed share, mirroring the
 * sibling plugin's own arithmetic (exposed for tests).
 * @param remainingPercent - remaining share 0-100.
 * @returns consumed share 0-100.
 */
export declare function usedPercentFromRemaining(remainingPercent: number): number;
