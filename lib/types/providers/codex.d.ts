/**
 * OpenAI Codex / ChatGPT subscription quota adapter.
 *
 * dsh-codex owns the ChatGPT OAuth credential and the usage endpoint, and its
 * own loopback route (`/plugins/dsh-openai-codex/auth/status`) already returns
 * the parsed `usage` block:
 *
 * ```json
 * { "rateLimits": [{ "id": "codex", "name": "Codex",
 *     "windows": [{ "remainingPercent": 0, "windowSeconds": 2592000, "resetAt": 1791547033 }] }],
 *   "credits": { "unlimited": false, "balance": "1288.80" } }
 * ```
 *
 * `windowSeconds` is how the window is classified: Codex reports a 5-hour
 * session window and a 7-day weekly one, and the two must be labelled
 * differently or the user cannot tell which limit they are hitting.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/codex
 */
import type { ProviderQuota } from '../contract.js';
import { type ProviderContext } from './util.js';
/**
 * Read the Codex subscription limits.
 * @param ctx - host-provided deps.
 * @param pluginBase - origin of the running DSH web server.
 * @returns the provider snapshot.
 */
export declare function readCodex(ctx: ProviderContext, pluginBase: string): Promise<ProviderQuota>;
