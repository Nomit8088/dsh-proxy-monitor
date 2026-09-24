/**
 * Antigravity integration into dsh-proxy-monitor.
 *
 * Re-uses antigravity's AntigravityAdapter and registers LLM route if not already claimed,
 * and exposes web endpoints (/antigravity/api/...) for models/settings if needed.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  FileCredentialStore,
  FileModelSettingsStore,
  AntigravityAdapter,
  PROVIDER,
  credentialPath,
  modelSettingsPath,
  apply as applyAntigravity,
} from './antigravity/index.js'
import { installOrTakeOverAdapter } from './llm-takeover.js'

export function setupAntigravity(ctx: Context) {
  const store = new FileCredentialStore(credentialPath())
  const modelSettings = new FileModelSettingsStore(modelSettingsPath())

  // Check if llm service already has antigravity adapter registered
  ctx.inject(['llm'], (llmCtx) => {
    const adapter = new AntigravityAdapter(store, modelSettings)
    installOrTakeOverAdapter(llmCtx.llm as never, PROVIDER, adapter as never, ctx.logger)
  })

  // Web API shares the same file-backed stores as the adapter. Adapter
  // registration is owned above so a leftover standalone plugin does not
  // trip DUPLICATE_ADAPTER and skip /antigravity/api.
  applyAntigravity(ctx, { store, modelSettings, registerAdapter: false })

  return {
    store,
    modelSettings,
  }
}
