/**
 * Claude / Anthropic subscription usage adapter.
 *
 * Claude Code reads its own subscription usage from an undocumented OAuth
 * endpoint — `GET https://api.anthropic.com/api/oauth/usage` — which answers
 * the 5-hour rolling session window and the 7-day weekly window as
 * `{ utilization, resets_at }` pairs. `utilization` is already a consumed
 * percentage, and `anthropic-beta: oauth-2025-04-20` is required or the
 * endpoint answers 401.
 *
 * This environment currently holds no Claude credential, so the adapter
 * normally reports `unconfigured`. It is implemented rather than stubbed so
 * that signing the Claude Code CLI in on this machine makes the row appear
 * with no further change. The credential is read from the CLI's own document
 * (`~/.claude/.credentials.json` → `claudeAiOauth.accessToken`); the sibling
 * `mcpOAuth.*` entries are unrelated MCP tokens and are deliberately ignored.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/claude
 */
import type { ProviderQuota } from '../contract.js';
import { type ProviderContext } from './util.js';
/**
 * Read the Claude subscription windows.
 * @param ctx - host-provided deps.
 * @returns the provider snapshot.
 */
export declare function readClaude(ctx: ProviderContext): Promise<ProviderQuota>;
