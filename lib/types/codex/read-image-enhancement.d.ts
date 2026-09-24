/** Optional HTTP(S) input for Harness's existing `read_image` tool. */
import type { Context } from '@deepseek-ai/cordis';
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ImageToolPolicy } from './tool-policy.js';
import type { PublicHttpRuntime } from './public-http.js';
/** Harness's canonical image-reading tool name. */
export declare const READ_IMAGE_TOOL_NAME = "read_image";
/** Detect one supported encoded raster format from its magic bytes. */
export declare function imageMediaType(data: Uint8Array): ImageMediaType | undefined;
/** Build an agent-scoped `read_image` definition that delegates local paths to Harness. */
export declare function enhancedReadImageTool(ctx: Context, original: ToolDefinition, publicHttpRuntime?: PublicHttpRuntime): ToolDefinition;
/** Keep an enhanced `read_image` shadow on every live agent while the setting is enabled. */
export declare function installReadImageEnhancement(ctx: Context, policy: ImageToolPolicy, publicHttpRuntime?: PublicHttpRuntime): void;
