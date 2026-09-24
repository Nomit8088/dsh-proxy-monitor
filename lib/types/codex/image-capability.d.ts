import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
/** Require the current conversation model to accept the image block a tool returns. */
export declare function assertImageCapable(ctx: Context, exec: ToolExecution, action: string): Promise<void>;
