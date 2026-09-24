/** ChatGPT Codex image generation and reference-image editing. */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { OpenAICodexCredentialStore } from './store.js';
import type { ImageToolPolicy } from './tool-policy.js';
/** Stable Codex-compatible tool name. */
export declare const IMAGEGEN_TOOL_NAME = "imagegen";
/** Image model selected by the official Codex image extension. */
export declare const OPENAI_CODEX_IMAGE_MODEL = "gpt-image-2";
/** Standalone generation endpoint used by the official Codex client. */
export declare const OPENAI_CODEX_IMAGE_GENERATIONS_URL = "https://chatgpt.com/backend-api/codex/images/generations";
/** Reference-image edit endpoint used by the official Codex client. */
export declare const OPENAI_CODEX_IMAGE_EDITS_URL = "https://chatgpt.com/backend-api/codex/images/edits";
/** OAuth-backed client for the two fixed ChatGPT Codex image endpoints. */
export declare class OpenAICodexImageClient {
    private readonly requestFetch;
    private readonly models;
    /**
     * @param credentials - shared refreshable OAuth store.
     * @param requestFetch - request transport used after credentials resolve.
     */
    constructor(credentials: OpenAICodexCredentialStore, requestFetch?: typeof globalThis.fetch);
    /** Send one generation or edit request and return the first PNG payload. */
    generate(prompt: string, images: readonly string[], signal: AbortSignal): Promise<Uint8Array>;
}
/** Build the plugin-owned Codex image generation and editing tool. */
export declare function imagegenTool(ctx: Context, credentials: OpenAICodexCredentialStore, policy: ImageToolPolicy, requestFetch?: typeof globalThis.fetch): ToolDefinition;
