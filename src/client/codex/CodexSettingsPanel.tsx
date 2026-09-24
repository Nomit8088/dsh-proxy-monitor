/**
 * OpenAI Codex settings tab rendered inside the unified reverse-proxy shell.
 *
 * Provides all preferences from dsh-codex:
 * - Proxy configuration (off, scoped, global) and proxy URL
 * - Model catalog selection
 * - Context window token override & Spark override
 * - Image tools (modifyReadImage, shareImagegenWithOtherModels)
 * - Response API (webSocketContextReuse, nativeCompaction)
 * - Fast Mode default
 */

import { type ReactNode } from "react";
import { OpenAICodexSettings } from "./OpenAICodexSettings.js";
import { zh, type OpenAICodexSettingsKey } from "./locales.js";

/** Default translation function using zh dictionary with placeholder replacement. */
function defaultTranslate(key: OpenAICodexSettingsKey, params?: Record<string, unknown>): string {
  let template = zh[key] ?? key;
  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) {
      template = template.replaceAll(`{${k}}`, String(v));
    }
  }
  return template;
}

/** Standalone panel for Codex preferences. */
export function CodexSettingsPanel(): ReactNode {
  return (
    <div style={{ marginTop: 16 }}>
      <OpenAICodexSettings t={defaultTranslate} />
    </div>
  );
}
