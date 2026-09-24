/** Secret-free diagnostics and duplicate-provider guidance. */
import { lstat } from 'node:fs/promises';
import { openAICodexAuthPath, OPENAI_CODEX_PROVIDER } from './store.js';
import { detectCompatibility, } from './compatibility.js';
export { CODEX_CONNECT_VERSION } from './version.js';
import { CODEX_CONNECT_VERSION } from './version.js';
/** Actionable message for legacy/manual `openai-codex` adapter collisions. */
export function openAICodexConflictMessage() {
    return 'dsh-codex cannot register provider "openai-codex" because another adapter already owns it. '
        + 'Remove or disable the duplicate bundle or manual openai-codex provider row, then restart Harness.';
}
/** Fail before the generic registry error so the collision has a migration hint. */
export function assertNoOpenAICodexProviderConflict(providerIds) {
    if (providerIds.includes(OPENAI_CODEX_PROVIDER))
        throw new Error(openAICodexConflictMessage());
}
/**
 * Inspect only process and filesystem metadata. This function never opens the
 * OAuth document, refreshes a token, or starts an authorization flow.
 */
export async function diagnoseOpenAICodex(options = {}) {
    const path = options.credentialPath ?? openAICodexAuthPath();
    let state = 'missing';
    let mode;
    try {
        const info = await lstat(path);
        if (!info.isFile()) {
            state = 'not-a-regular-file';
        }
        else if (process.platform === 'win32') {
            state = 'owner-only';
        }
        else {
            mode = (info.mode & 0o777).toString(8).padStart(3, '0');
            state = (info.mode & 0o077) === 0 ? 'owner-only' : 'permissions-too-broad';
        }
    }
    catch (error) {
        state = error?.code === 'ENOENT'
            ? 'missing'
            : 'unreadable-metadata';
    }
    const providerConflict = options.providerIds?.includes(OPENAI_CODEX_PROVIDER) ?? false;
    const compatibility = await detectCompatibility(options.compatibilityOptions);
    const hints = [];
    if (state === 'missing')
        hints.push('Sign in only when you are ready; installation does not start OAuth.');
    if (state === 'permissions-too-broad')
        hints.push(`Restrict the OAuth file to its owner before use (current mode ${mode}).`);
    if (state === 'not-a-regular-file')
        hints.push('Replace the OAuth path with an owner-only regular file created by dsh-codex login.');
    if (state === 'unreadable-metadata')
        hints.push('Harness could not inspect the OAuth file metadata; check the parent directory and file ownership.');
    if (providerConflict)
        hints.push(openAICodexConflictMessage());
    if (!providerConflict)
        hints.push('If Harness reports a duplicate openai-codex adapter, remove the legacy bundle or manual provider row.');
    if (compatibility.status === 'incompatible') {
        hints.push('Compatibility mismatch: install the declared DSH plugin API versions and pin @earendil-works/pi-ai to 0.84.4, then run doctor again; no files are changed automatically.');
    }
    else if (compatibility.status === 'unknown') {
        hints.push('Compatibility is unknown: verify the declared DSH plugin API and @earendil-works/pi-ai versions, then run doctor again.');
    }
    return {
        package: 'dsh-codex',
        version: CODEX_CONNECT_VERSION,
        node: process.version,
        credentialFile: { path, state, ...mode === undefined ? {} : { mode } },
        capabilities: {
            modelProvider: true,
            search: options.enableSearch ?? true,
            imageTool: options.enableImageTool ?? true,
            changesHarnessDefaultModel: true,
            changesHarnessSearchRoute: true,
        },
        providerConflict,
        compatibility,
        hints,
    };
}
//# sourceMappingURL=doctor.js.map