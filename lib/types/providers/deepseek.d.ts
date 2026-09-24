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
import type { ProviderQuota } from '../contract.js';
import { type ProviderContext } from './util.js';
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
export declare function readDeepSeek(ctx: ProviderContext): Promise<ProviderQuota>;
/**
 * Whether a DeepSeek response looks like a usable balance payload (exposed for
 * tests; the reader above is the production path).
 * @param value - candidate payload.
 * @returns true when at least one balance row carries a total.
 */
export declare function hasBalanceRows(value: unknown): boolean;
