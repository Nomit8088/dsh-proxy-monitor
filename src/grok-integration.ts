/**
 * Grok LLM adapter + live model catalog routes for dsh-proxy-monitor.
 */

import type { Context } from '@deepseek-ai/cordis'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

import { GrokAuthAdapter, GROK_ROUTE } from './grok/grok-auth-adapter.js'
import { GrokModelCatalog } from './grok/grok-models.js'
import { GrokModelSettingsStore, type GrokCatalogModel } from './grok/model-settings.js'
import type { GrokAuthService } from './grok/grok-auth-service.js'
import { withUserImageSupport } from './catalog/preferences.js'
import { installOrTakeOverAdapter } from './llm-takeover.js'

export const GROK_MODELS_PATH = '/plugins/dsh-proxy-monitor/grok/models'

function liveCatalogModels(catalog: GrokModelCatalog | undefined): GrokCatalogModel[] {
  const base = builtinProviders().find(candidate => candidate.id === GROK_ROUTE)
  const models = catalog === undefined ? (base?.getModels() ?? []) : catalog.merge(base?.getModels() ?? [])
  return models.map(model => ({
    id: model.id,
    name: model.name,
    supportsImages: Array.isArray(model.input) && model.input.includes('image'),
  }))
}

function optionsPayload(settings: {
  enabledModelIds: string[]
  imageModelIds: string[]
  catalogModels: GrokCatalogModel[]
}) {
  const enabled = new Set(settings.enabledModelIds)
  const imageIds = new Set(settings.imageModelIds)
  const source = settings.catalogModels.length > 0 ? settings.catalogModels : liveCatalogModels(undefined)
  return {
    enabledModelIds: [...enabled],
    imageModelIds: [...imageIds],
    options: source.map(model => {
      const applied = withUserImageSupport(model, imageIds)
      return {
        id: applied.id,
        name: model.name,
        enabled: enabled.has(model.id),
        supportsImages: applied.inputModalities.includes('image'),
        inputModalities: applied.inputModalities,
      }
    }),
  }
}

function sendJson(response: { writeHead: Function; end: Function }, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

/** Register the Grok adapter (when free) and the live catalog HTTP surface. */
export function setupGrok(ctx: Context, grokService: GrokAuthService) {
  const modelSettings = new GrokModelSettingsStore()
  void modelSettings.read().catch(error => {
    ctx.logger.warn('dsh-proxy-monitor: grok model settings read failed: %s', String(error))
  })

  const catalog = new GrokModelCatalog({
    resolveAccessToken: async () => (await grokService.credential())?.accessToken,
    warn: message => { ctx.logger.warn('dsh-proxy-monitor: grok live models: %s', message) },
    onChange: () => {
      const live = liveCatalogModels(catalog)
      void modelSettings.adoptLiveCatalog(live).then(() => {
        try { ctx.emit('llm/adapters-updated') } catch { /* best-effort */ }
      })
    },
  })

  ctx.inject(['llm'], llmCtx => {
    const adapter = new GrokAuthAdapter(ctx, {
      auth: grokService,
      credentialRef: credentialRef('GROK_OAUTH_TOKEN'),
      displayName: 'Grok',
      baseUrl: '',
      timeoutMs: 120_000,
      liveModels: true,
      catalog,
      visibleModelIds: () => {
        const snap = modelSettings.snapshot()
        if (snap.catalogModels.length === 0 && snap.enabledModelIds.length === 0) return undefined
        return snap.enabledModelIds
      },
      imageModelIds: () => modelSettings.snapshot().imageModelIds,
    })
    installOrTakeOverAdapter(llmCtx.llm as never, GROK_ROUTE, adapter as never, ctx.logger)
  })

  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: GROK_MODELS_PATH,
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                const settings = await modelSettings.read()
                return sendJson(response, 200, { ok: true, value: optionsPayload(settings) })
              }
              if (request.method === 'POST') {
                const chunks: Buffer[] = []
                for await (const chunk of request) chunks.push(Buffer.from(chunk))
                const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
                if (body['refresh'] === true) {
                  await catalog.refresh()
                  const live = liveCatalogModels(catalog)
                  const settings = await modelSettings.adoptLiveCatalog(live)
                  try { ctx.emit('llm/adapters-updated') } catch { /* best-effort */ }
                  return sendJson(response, 200, { ok: true, value: optionsPayload(settings) })
                }
                const hasEnabled = Array.isArray(body['enabledModelIds'])
                const hasImage = Array.isArray(body['imageModelIds'])
                if (!hasEnabled && !hasImage) {
                  return sendJson(response, 400, { ok: false, error: 'enabledModelIds or imageModelIds must be an array' })
                }
                const settings = await modelSettings.modify(current => ({
                  ...current,
                  ...(hasEnabled ? { enabledModelIds: body['enabledModelIds'] as string[] } : {}),
                  ...(hasImage ? { imageModelIds: body['imageModelIds'] as string[] } : {}),
                }))
                try { ctx.emit('llm/adapters-updated') } catch { /* best-effort */ }
                return sendJson(response, 200, { ok: true, value: optionsPayload(settings) })
              }
              return sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            } catch (error) {
              return sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
      'dsh-proxy-monitor: grok model catalog',
    )
  })

  return { modelSettings, catalog }
}
