/**
 * WorkBuddy integration into dsh-proxy-monitor (CN-only).
 *
 * Imports WorkBuddy's apply and config from src/workbuddy/index.js,
 * applies it to Context so the /plugins/dsh-workbuddy-connect/status endpoint
 * and the 'workbuddy' LLM route are fully active in this single plugin.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  apply as applyWorkBuddy,
  Config as WorkBuddyConfig,
  WORKBUDDY_PROVIDER,
  WorkBuddyCredentialStore,
  CN_VARIANT,
} from './workbuddy/index.js'
import { overlayWorkBuddyAdapterModels, registerWorkBuddyCatalogApi } from './catalog-http.js'
import { recordSetupOutcome, reasonText } from './diagnostics.js'
import { wrapAdapterCatalog } from './llm-takeover.js'
import { patchWorkBuddyEncryptedAuth } from './workbuddy/patch-encrypted-auth.js'

export function setupWorkBuddy(ctx: Context) {
  // WorkBuddy 5.6 encrypts desktop tokens; patch before apply() constructs stores.
  patchWorkBuddyEncryptedAuth()

  const store = new WorkBuddyCredentialStore({
    variant: CN_VARIANT,
    refresh: () => Promise.reject(new Error('refresh not needed')),
  })

  // Apply the WorkBuddy backend runtime (endpoints, sweep, catalog, LLM route)
  // FIRST. `apply()` is what registers the 'workbuddy' adapter, and the catalog
  // overlay can only wrap an adapter that already owns the route: wrapping
  // before this point logs "no adapter owns the route yet" and leaves the
  // picker reading the raw, unfiltered catalog.
  try {
    const defaultConfig = WorkBuddyConfig({})
    applyWorkBuddy(ctx as any, defaultConfig)
    recordSetupOutcome({ provider: WORKBUDDY_PROVIDER, phase: 'apply', ok: true })
  } catch (err) {
    recordSetupOutcome({ provider: WORKBUDDY_PROVIDER, phase: 'apply', ok: false, error: reasonText(err) })
    ctx.logger.warn('dsh-proxy-monitor: workbuddy apply notice: %s', String(err))
  }

  // Overlay the picker's catalog. Re-applied on every topology change because a
  // registration (a later generation, a leftover bundle) replaces the adapter
  // instance and with it everything this wrap installed; the wrap is idempotent
  // for the instance it already owns, so re-checking is free.
  ctx.inject(['llm'], llmCtx => {
    let unwrap: () => void = () => {}
    const overlay = () => {
      unwrap = wrapAdapterCatalog(
        llmCtx.llm as never,
        WORKBUDDY_PROVIDER,
        {
          listModels: async (original, provider) => {
            const models = await original(provider)
            return overlayWorkBuddyAdapterModels(models)
          },
          resolveModel: async (original, provider, model, signal) => {
            const resolved = await original(provider, model, signal)
            const [overlaid] = await overlayWorkBuddyAdapterModels([resolved])
            return overlaid ?? resolved
          },
        },
        ctx.logger,
      )
    }
    overlay()
    llmCtx.on('llm/adapters-updated', overlay)
    llmCtx.effect(() => () => { unwrap() }, 'dsh-proxy-monitor: workbuddy picker catalog')
  })

  // Own catalog URL — a fallback for the case where the vendored runtime's own
  // registration did not happen (its apply() may throw DUPLICATE_ADAPTER before
  // its inner inject runs). Both handlers read and write the same preferences
  // file, so whichever one wins the URL serves the same answers.
  registerWorkBuddyCatalogApi(ctx)

  return {
    store,
  }
}
