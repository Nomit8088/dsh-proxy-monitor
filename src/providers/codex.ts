/**
 * OpenAI Codex / ChatGPT subscription quota adapter.
 *
 * dsh-codex owns the ChatGPT OAuth credential and the usage endpoint, and its
 * own loopback route (`/plugins/dsh-openai-codex/auth/status`) already returns
 * the parsed `usage` block:
 *
 * ```json
 * { "rateLimits": [{ "id": "codex", "name": "Codex",
 *     "windows": [{ "remainingPercent": 0, "windowSeconds": 2592000, "resetAt": 1791547033 }] }],
 *   "credits": { "unlimited": false, "balance": "1288.80" } }
 * ```
 *
 * `windowSeconds` is how the window is classified: Codex reports a 5-hour
 * session window and a 7-day weekly one, and the two must be labelled
 * differently or the user cannot tell which limit they are hitting.
 *
 * @module @dsh-external/dsh-proxy-monitor/providers/codex
 */

import type { ProviderQuota, QuotaWindow, WindowKind } from '../contract.js'
import {
  clampPercent,
  fetchJson,
  isRecord,
  num,
  reasonOf,
  str,
  toIso,
  usedFromRemaining,
  windowOf,
  type ProviderContext,
} from './util.js'

/** The plugin-owned route, served by dsh-codex's host half. */
const PLUGIN_STATUS_PATH = '/plugins/dsh-openai-codex/auth/status'

/** Classify a window by its length in seconds. */
function kindOfSeconds(seconds: number | undefined): WindowKind {
  if (seconds === undefined) return 'other'
  if (seconds <= 6 * 60 * 60) return 'session'
  if (seconds <= 8 * 24 * 60 * 60) return 'weekly'
  return 'monthly'
}

/** A human label for a window length. */
function labelOfSeconds(seconds: number | undefined): string {
  if (seconds === undefined) return 'Limit'
  if (seconds <= 6 * 60 * 60) return 'Current session'
  if (seconds <= 8 * 24 * 60 * 60) return 'All models'
  return 'Monthly'
}

/** A short "5h" / "7d" style descriptor. */
function spanOfSeconds(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined
  const hours = seconds / 3600
  if (hours < 24) return `${String(Math.round(hours))}h window`
  return `${String(Math.round(hours / 24))}d window`
}

/** Flatten the plugin's rate-limit groups into windows. */
function windowsOf(rateLimits: readonly unknown[]): QuotaWindow[] {
  const windows: QuotaWindow[] = []
  for (const group of rateLimits) {
    if (!isRecord(group)) continue
    const groupId = str(group, 'id') ?? 'limit'
    const groupName = str(group, 'name')
    const groupWindows = Array.isArray(group['windows']) ? group['windows'] : []
    for (const [index, entry] of groupWindows.entries()) {
      if (!isRecord(entry)) continue
      const remaining = num(entry, 'remainingPercent')
      if (remaining === undefined) continue
      const seconds = num(entry, 'windowSeconds')
      const kind = kindOfSeconds(seconds)
      const label = groupWindows.length > 1 || groupName === undefined
        ? labelOfSeconds(seconds)
        : groupName
      windows.push(
        windowOf(
          { id: `${groupId}-${String(index)}`, label, kind },
          {
            usedPercent: usedFromRemaining(clampPercent(remaining)),
            resetAt: toIso(entry['resetAt']),
            detail: spanOfSeconds(seconds),
          },
        ),
      )
    }
  }
  return windows
}

/**
 * Read the Codex subscription limits.
 * @param ctx - host-provided deps.
 * @param pluginBase - origin of the running DSH web server.
 * @returns the provider snapshot.
 */
export async function readCodex(ctx: ProviderContext, pluginBase: string): Promise<ProviderQuota> {
  const base = { id: 'codex' as const, name: 'Codex', fetchedAt: Date.now() }
  try {
    const payload = await fetchJson(`${pluginBase}${PLUGIN_STATUS_PATH}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (!isRecord(payload)) throw new Error('malformed status response')

    const state = str(payload, 'status')
    if (state !== 'signed-in') {
      return {
        ...base,
        status: 'unconfigured',
        windows: [],
        error: str(payload, 'reason') ?? 'ChatGPT account is not signed in',
      }
    }

    const usage = payload['usage']
    const usageError = str(payload, 'quotaError')
    if (!isRecord(usage)) {
      return { ...base, status: 'error', windows: [], error: usageError ?? 'Codex reported no usage block' }
    }

    const rateLimits = Array.isArray(usage['rateLimits']) ? usage['rateLimits'] : []
    const windows = windowsOf(rateLimits)

    // A credit balance is shown as text; it is not an allowance percentage.
    let balance: string | undefined
    const credits = usage['credits']
    if (isRecord(credits)) {
      if (credits['unlimited'] === true) balance = 'unlimited'
      else {
        const raw = str(credits, 'balance')
        if (raw !== undefined) balance = `${raw} credits`
      }
    }

    const individual = usage['individualLimit']
    if (isRecord(individual)) {
      const remaining = num(individual, 'remainingPercent')
      if (remaining !== undefined) {
        windows.push(
          windowOf(
            { id: 'individual', label: 'Individual limit', kind: 'other' },
            {
              usedPercent: usedFromRemaining(clampPercent(remaining)),
              detail: 'per-account cap',
            },
          ),
        )
      }
    }

    if (windows.length === 0) {
      return {
        ...base,
        status: 'error',
        windows: [],
        ...(balance === undefined ? {} : { balance }),
        error: usageError ?? 'Codex reported no limit windows',
      }
    }

    // The session window is the one that actually blocks work, so it leads.
    const session = windows.find(entry => entry.kind === 'session')
    const headline = session ?? windows[0]
    return {
      ...base,
      status: 'ok',
      plan: 'ChatGPT subscription',
      ...(balance === undefined ? {} : { balance }),
      ...(headline?.usedPercent === undefined ? {} : { usedPercent: headline.usedPercent }),
      windows,
    }
  } catch (error) {
    return { ...base, status: 'error', windows: [], error: reasonOf(error) }
  }
}
