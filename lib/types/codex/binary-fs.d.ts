import type { Context } from '@deepseek-ai/cordis';
import type { FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
/** Result returned by binary publication. */
export interface FsBytesWriteOutcome {
    operation: 'create' | 'update';
    version: FsVersion;
    bytes: number;
}
/** Publish bytes in the active world, with a self-contained local fallback for released DSH versions. */
export declare function writeWorkspaceBytes(ctx: Context, exec: ToolExecution, target: FsTarget, content: Uint8Array, expected?: FsWriteIntent): Promise<FsBytesWriteOutcome>;
