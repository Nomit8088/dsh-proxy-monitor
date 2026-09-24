/**
 * Plugin-owned model-catalog HTTP surfaces that do not share paths with the
 * leftover standalone bundles (dsh-codex / dsh-workbuddy-connect).
 *
 * Those bundles still occupy `/plugins/dsh-openai-codex/models` and never
 * registered `/plugins/dsh-workbuddy-connect/models`, so this plugin must
 * serve its own URLs or the settings UI 404/405s.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defaultImageModelIdsFrom, mergeEnabledModelIds, mergeImageModelIds, withUserImageSupport, } from './catalog/preferences.js';
import { resolveDshHome } from './home.js';
export const WORKBUDDY_MODELS_API = '/plugins/dsh-proxy-monitor/workbuddy/models';
export const CODEX_MODELS_API = '/plugins/dsh-proxy-monitor/codex/models';
const WORKBUDDY_STATUS = '/plugins/dsh-workbuddy-connect/status';
const WORKBUDDY_PROBE = '/plugins/dsh-workbuddy-connect/probe';
function sendJson(response, status, body) {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(JSON.stringify(body));
}
async function readJsonBody(request) {
    const chunks = [];
    for await (const chunk of request)
        chunks.push(Buffer.from(chunk));
    if (chunks.length === 0)
        return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : {};
}
function loopbackBase(ctx) {
    const server = ctx.get('webServer');
    const port = server?.port ?? 3080;
    const host = server?.host === '0.0.0.0' ? '127.0.0.1' : (server?.host ?? '127.0.0.1');
    return `http://${host}:${String(port)}`;
}
function prefsPath() {
    return join(resolveDshHome(), 'storages', 'workbuddy-model-settings.json');
}
async function readPrefs() {
    try {
        const parsed = JSON.parse(await readFile(prefsPath(), 'utf8'));
        return {
            enabledModelIds: Array.isArray(parsed.enabledModelIds) ? parsed.enabledModelIds.filter(id => typeof id === 'string') : [],
            imageModelIds: Array.isArray(parsed.imageModelIds) ? parsed.imageModelIds.filter(id => typeof id === 'string') : [],
            catalogModels: Array.isArray(parsed.catalogModels) ? parsed.catalogModels : [],
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
        };
    }
    catch {
        return { enabledModelIds: [], imageModelIds: [], catalogModels: [], updatedAt: 0 };
    }
}
async function writePrefs(next) {
    const payload = { ...next, updatedAt: Date.now() };
    await mkdir(dirname(prefsPath()), { recursive: true });
    const temp = `${prefsPath()}.tmp`;
    await writeFile(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    await rename(temp, prefsPath());
    return payload;
}
function inferImage(id) {
    return /(?:^|[-_])(?:vl|vision|5v|4v|image)/i.test(id);
}
function optionsFromStatus(models, prefs) {
    const catalog = models.map(model => ({
        id: model.id,
        name: model.name ?? model.id,
        supportsImages: inferImage(model.id),
        contextWindow: model.contextWindow,
        credits: model.credits,
    }));
    const enabled = new Set(prefs.enabledModelIds.length > 0 || prefs.catalogModels.length > 0
        ? prefs.enabledModelIds
        : catalog.map(model => model.id));
    const imageIds = new Set(prefs.imageModelIds.length > 0 || prefs.catalogModels.length > 0
        ? prefs.imageModelIds
        : defaultImageModelIdsFrom(catalog));
    return {
        enabledModelIds: [...enabled],
        imageModelIds: [...imageIds],
        options: catalog.map(model => {
            const applied = withUserImageSupport(model, imageIds);
            const meta = [
                model.id,
                typeof model.contextWindow === 'number' ? `${String(model.contextWindow)} ctx` : undefined,
                model.credits,
            ].filter((part) => part !== undefined);
            return {
                id: model.id,
                name: model.name,
                enabled: enabled.has(model.id),
                supportsImages: applied.inputModalities.includes('image'),
                inputModalities: applied.inputModalities,
                meta: meta.join(' · '),
            };
        }),
    };
}
async function loadWorkBuddyStatus(ctx) {
    const response = await fetch(`${loopbackBase(ctx)}${WORKBUDDY_STATUS}`, {
        headers: { accept: 'application/json', host: new URL(loopbackBase(ctx)).host },
    });
    const body = await response.json();
    const models = Array.isArray(body['models'])
        ? body['models'].flatMap((row) => {
            if (typeof row !== 'object' || row === null)
                return [];
            const rec = row;
            if (typeof rec['id'] !== 'string')
                return [];
            return [{
                    id: rec['id'],
                    name: typeof rec['name'] === 'string' ? rec['name'] : rec['id'],
                    contextWindow: typeof rec['contextWindow'] === 'number' ? rec['contextWindow'] : undefined,
                    credits: typeof rec['credits'] === 'string' ? rec['credits'] : undefined,
                }];
        })
        : [];
    return {
        models,
        probeKey: typeof body['probeKey'] === 'string' ? body['probeKey'] : undefined,
    };
}
async function refreshWorkBuddyCatalog(ctx, probeKey) {
    const base = loopbackBase(ctx);
    const host = new URL(base).host;
    const response = await fetch(`${base}${WORKBUDDY_PROBE}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            host,
            'x-workbuddy-probe-key': probeKey,
        },
        body: JSON.stringify({ action: 'refresh' }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`WorkBuddy catalog refresh failed (HTTP ${String(response.status)}): ${text.slice(0, 200)}`);
    }
}
/** Apply saved enable / image flags onto a leftover WorkBuddy adapter catalog. */
export async function overlayWorkBuddyAdapterModels(models) {
    const prefs = await readPrefs();
    const enabled = new Set(prefs.enabledModelIds.length > 0 || prefs.catalogModels.length > 0
        ? prefs.enabledModelIds
        : models.map(model => model.id));
    const imageIds = new Set(prefs.imageModelIds.length > 0 || prefs.catalogModels.length > 0
        ? prefs.imageModelIds
        : models.filter(model => inferImage(model.id) || model.inputModalities?.includes('image')).map(model => model.id));
    return models
        .filter(model => enabled.has(model.id))
        .map(model => ({
        ...model,
        inputModalities: imageIds.has(model.id) ? ['text', 'image'] : ['text'],
    }));
}
/** Register the WorkBuddy catalog API even when the standalone bundle already applied. */
export function registerWorkBuddyCatalogApi(ctx) {
    ctx.inject(['webServer'], webCtx => {
        webCtx.effect(() => webCtx.webServer.register({
            kind: 'exact',
            path: WORKBUDDY_MODELS_API,
            handler: async (request, response) => {
                try {
                    if (request.method === 'GET') {
                        const status = await loadWorkBuddyStatus(ctx);
                        const prefs = await readPrefs();
                        return sendJson(response, 200, { ok: true, value: optionsFromStatus(status.models, prefs) });
                    }
                    if (request.method !== 'POST') {
                        return sendJson(response, 405, { ok: false, error: 'method-not-allowed' });
                    }
                    const body = await readJsonBody(request);
                    if (body['refresh'] === true) {
                        const before = await loadWorkBuddyStatus(ctx);
                        if (before.probeKey !== undefined) {
                            await refreshWorkBuddyCatalog(ctx, before.probeKey);
                        }
                        const after = await loadWorkBuddyStatus(ctx);
                        const current = await readPrefs();
                        const catalogModels = after.models.map(model => ({
                            id: model.id,
                            name: model.name ?? model.id,
                            supportsImages: inferImage(model.id),
                        }));
                        const prefs = await writePrefs({
                            catalogModels,
                            enabledModelIds: mergeEnabledModelIds(current, catalogModels),
                            imageModelIds: mergeImageModelIds(current, catalogModels),
                            updatedAt: Date.now(),
                        });
                        try {
                            ctx.emit('llm/adapters-updated');
                        }
                        catch { /* picker refresh */ }
                        return sendJson(response, 200, { ok: true, value: optionsFromStatus(after.models, prefs) });
                    }
                    const hasEnabled = Array.isArray(body['enabledModelIds']);
                    const hasImage = Array.isArray(body['imageModelIds']);
                    if (!hasEnabled && !hasImage) {
                        return sendJson(response, 400, { ok: false, error: 'enabledModelIds or imageModelIds must be an array' });
                    }
                    const status = await loadWorkBuddyStatus(ctx);
                    const current = await readPrefs();
                    const prefs = await writePrefs({
                        catalogModels: status.models.map(model => ({
                            id: model.id,
                            name: model.name ?? model.id,
                            supportsImages: inferImage(model.id),
                        })),
                        enabledModelIds: hasEnabled ? body['enabledModelIds'] : current.enabledModelIds,
                        imageModelIds: hasImage ? body['imageModelIds'] : current.imageModelIds,
                        updatedAt: Date.now(),
                    });
                    try {
                        ctx.emit('llm/adapters-updated');
                    }
                    catch { /* picker refresh */ }
                    return sendJson(response, 200, { ok: true, value: optionsFromStatus(status.models, prefs) });
                }
                catch (error) {
                    return sendJson(response, 500, {
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            },
        }), 'dsh-proxy-monitor: workbuddy model catalog');
    });
}
//# sourceMappingURL=catalog-http.js.map