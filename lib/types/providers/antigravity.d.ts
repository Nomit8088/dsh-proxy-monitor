/**
 * Google Antigravity / Cloud Code Assist quota adapter.
 *
 * dsh-antigravity already owns the OAuth credential file, the project lookup,
 * and the quota-summary parsing, and publishes the normalized result on its own
 * loopback route (`/antigravity/api/quota`). This adapter consumes that route
 * first, because re-implementing the plugin's project-id resolution and tier
 * parsing would drift from it; when the route is absent it reads the
 * credential file and calls the upstream endpoint directly.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/antigravity
 */
import type { ProviderQuota } from '../contract.js';
import { type ProviderContext } from './util.js';
/**
 * Read the Antigravity quota.
 * @param ctx - host-provided deps.
 * @param pluginBase - origin of the running DSH web server.
 * @returns the provider snapshot.
 */
export declare function readAntigravity(ctx: ProviderContext, pluginBase: string): Promise<ProviderQuota>;
