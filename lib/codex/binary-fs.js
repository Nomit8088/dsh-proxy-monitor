import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsError } from '@deepseek-ai/dsh-fs';
const localLocks = new Map();
function throwIfAborted(signal) {
    if (signal?.aborted === true)
        throw signal.reason;
}
async function withLocalLock(path, operation) {
    const prior = localLocks.get(path) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = prior.then(() => current);
    localLocks.set(path, tail);
    await prior;
    try {
        return await operation();
    }
    finally {
        release();
        if (localLocks.get(path) === tail)
            localLocks.delete(path);
    }
}
async function checkedLocalTarget(ctx, target, policy, signal) {
    if (ctx.fs.sandboxMode === undefined)
        return target;
    if (policy === undefined)
        throw new Error('the active filesystem confines writes but its sandbox policy is unavailable');
    if (policy.mode === 'read-only') {
        throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED');
    }
    if (policy.mode === 'danger-full-access')
        return target;
    const options = signal === undefined ? undefined : { signal };
    const fresh = await ctx.fs.resolve(target.displayPath, options);
    const root = await ctx.fs.resolve(policy.workspaceRoot, options);
    if (!ctx.fs.contains(root, fresh)) {
        throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED');
    }
    return fresh;
}
function resolveSandboxPolicy(ctx, exec) {
    const resolver = ctx.get('sandboxPolicy');
    return resolver?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session });
}
function isCode(error, code) {
    return error instanceof Error && 'code' in error && error.code === code;
}
async function publishLocal(path, displayPath, content, createIfAbsent, mode, signal) {
    throwIfAborted(signal);
    const parent = dirname(path);
    await mkdir(parent, { recursive: true });
    const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
        handle = await open(temporary, 'wx', mode ?? 0o600);
        await handle.writeFile(content, signal === undefined ? {} : { signal });
        await handle.sync();
        if (mode !== undefined && process.platform !== 'win32')
            await handle.chmod(mode);
        await handle.close();
        handle = undefined;
        throwIfAborted(signal);
        if (createIfAbsent) {
            try {
                await link(temporary, path);
            }
            catch (error) {
                if (isCode(error, 'EEXIST')) {
                    throw new FsError(`cannot overwrite existing "${displayPath}" without reading it first`, 'FS_NOT_OBSERVED', { cause: error });
                }
                throw error;
            }
        }
        else {
            await rename(temporary, path);
        }
    }
    finally {
        await handle?.close().catch(() => undefined);
        await rm(temporary, { force: true }).catch(() => undefined);
    }
}
async function writeLocalBytes(ctx, exec, original, content, expected, policy) {
    const target = await checkedLocalTarget(ctx, original, policy, exec.signal);
    const urlPath = fileURLToPath(ctx.fs.fileUrl(target));
    const processPath = ctx.fs.processPath(target);
    if (urlPath !== processPath)
        throw new Error('local filesystem path and file URL disagree');
    return withLocalLock(processPath, async () => {
        throwIfAborted(exec.signal);
        const info = await ctx.fs.stat(target, exec.signal);
        if (info !== undefined && info.type !== 'file') {
            throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE');
        }
        if (expected?.kind === 'replaceIfVersion'
            && (info === undefined || info.version !== expected.version)) {
            throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION');
        }
        if (expected?.kind === 'createIfAbsent' && info !== undefined) {
            throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED');
        }
        const native = info === undefined ? undefined : await lstat(processPath);
        await publishLocal(processPath, target.displayPath, content, expected?.kind === 'createIfAbsent', native?.mode, exec.signal);
        const written = await ctx.fs.stat(target, exec.signal);
        if (written === undefined)
            throw new FsError(`cannot stat written "${target.displayPath}"`, 'FS_IO_ERROR');
        return { operation: info === undefined ? 'create' : 'update', version: written.version, bytes: content.byteLength };
    });
}
/** Publish bytes in the active world, with a self-contained local fallback for released DSH versions. */
export async function writeWorkspaceBytes(ctx, exec, target, content, expected) {
    const policy = resolveSandboxPolicy(ctx, exec);
    const protocol = new URL(ctx.fs.fileUrl(target)).protocol;
    if (protocol === 'file:')
        return writeLocalBytes(ctx, exec, target, content, expected, policy);
    const writer = ctx.fs;
    if (typeof writer.writeBytes !== 'function') {
        throw new Error(`the active ${protocol} filesystem cannot save binary output; update its provider or omit output_path`);
    }
    return writer.writeBytes(target, content, expected, exec.signal, policy);
}
//# sourceMappingURL=binary-fs.js.map