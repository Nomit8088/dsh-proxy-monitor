/**
 * Codex composite features: LLM route, standalone search, imagegen, read_image, auth routes.
 *
 * This module encapsulates all backend services ported from dsh-codex.
 * It is called from the main plugin entry point `src/index.ts`.
 */
import type { Context } from "@deepseek-ai/cordis";
import { OpenAICodexWebAuth } from "./codex/auth-routes.js";
import { ImageToolPolicy } from "./codex/tool-policy.js";
import { FastModeRegistry } from "./codex/fast-mode.js";
import { OpenAICodexCredentialStore } from "./codex/store.js";
import { OpenAICodexService } from "./codex/service.js";
export interface CodexRuntimeComponents {
    service: OpenAICodexService;
    credentials: OpenAICodexCredentialStore;
    webAuth: OpenAICodexWebAuth;
    fastMode: FastModeRegistry;
    imageTools: ImageToolPolicy;
}
/**
 * Initialize Codex backend services and register routes/adapters.
 * If openai-codex is already registered (e.g. standalone dsh-codex plugin is active),
 * logs a notice and skips registering the LLM route and search provider to prevent conflicts.
 */
export declare function setupCodex(ctx: Context, credentialsStore?: OpenAICodexCredentialStore): CodexRuntimeComponents;
