/**
 * WorkBuddy / CodeBuddy credit adapter.
 *
 * dsh-workbuddy-connect already resolves the desktop app's sign-in and calls
 * the vendor billing endpoint, and publishes the result on its own loopback
 * route (`/plugins/dsh-workbuddy-connect/status`) as
 * `credits: { total, accounts: [{ packageName, remain, size }] }`.
 *
 * Those rows are the honest meter: each package has a granted `size` and a
 * remaining `remain`, so the consumed share is `(Σsize − Σremain) / Σsize`.
 * The plugin also reports a per-model `credits` multiplier (e.g. "x0.79"),
 * which is a *price ratio*, not an allowance — metering it would be wrong, so
 * it is surfaced as a detail line instead.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/workbuddy
 */
import type { ProviderQuota } from '../contract.js';
import { type ProviderContext } from './util.js';
/**
 * Read the WorkBuddy credit position.
 *
 * @param ctx - host-provided deps.
 * @param pluginBase - origin of the running DSH web server.
 * @returns the provider snapshot.
 */
export declare function readWorkBuddy(ctx: ProviderContext, pluginBase: string): Promise<ProviderQuota>;
