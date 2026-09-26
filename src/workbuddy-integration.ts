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
  WORKBUDDY_PROVIDER,
  WorkBuddyCredentialStore,
  CN_VARIANT,
} from './workbuddy/index.js'
import { overlayWorkBuddyAdapterModels, registerWorkBuddyCatalogApi } from './catalog-http.js'
import { recordSetupOutcome, reasonText } from './diagnostics.js'
import { wrapAdapterCatalog } from './llm-takeover.js'
import { patchWorkBuddyEncryptedAuth } from './workbuddy/patch-encrypted-auth.js'

/**
 * The host's live WorkBuddy configuration.
 *
 * Thunks rather than values: the vendored runtime reads these fields from
 * long-lived closures (a probe's consent check, a credential store's desktop
 * path), and the Config references change in place when the settings page
 * writes, so a snapshot taken here would freeze the first value ever seen.
 */
export interface WorkBuddyLiveOptions {
  /** Explicit CN desktop auth-file path, or undefined for the app's own file. */
  authFile(): string | undefined
  /** Explicit international desktop auth-file path, or undefined. */
  authFileAI(): string | undefined
  /** Whether the user authorized reasoning-effort probes. */
  probeConsent(): boolean
}

/** What the host half needs back from the vendored runtime. */
export interface WorkBuddyRuntime {
  /** Credential store the account face reads. */
  store: WorkBuddyCredentialStore
  /** Re-point every variant's credential store after a settings change. */
  repoint(): void
}

export function setupWorkBuddy(ctx: Context, live: WorkBuddyLiveOptions): WorkBuddyRuntime {
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
  let repoint: () => void = () => {}
  try {
    const runtimeConfig = {
      get authFile() {
        return live.authFile()
      },
      get authFileAI() {
        return live.authFileAI()
      },
      get probeConsent() {
        return live.probeConsent()
      },
    }
    const started = applyWorkBuddy(ctx as any, runtimeConfig)
    if (typeof started?.repoint === 'function') repoint = started.repoint
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
    repoint: () => {
      repoint()
    },
  }
}
