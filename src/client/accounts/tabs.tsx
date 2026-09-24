/**
 * The provider tabs the settings shell renders.
 *
 * This is the one file that knows *which* providers exist in the UI and what
 * each one's specific fields are. Everything structural — nav row, tab strip,
 * account block, login control — lives in {@link SectionShell} and
 * `AccountBlock`, so adding a provider is a tab entry here rather than a new
 * page.
 *
 * Each tab's `render` returns that provider's own settings surface. Those
 * surfaces arrive one at a time as each provider is migrated; until then a tab
 * renders its migration note, which is honest about what is and is not wired
 * (far better than an empty panel that looks broken).
 *
 * @module @dsh-external/dsh-proxy-monitor/client/accounts/tabs
 */

import type { ProviderAccount } from '../../accounts/contract.js'
import type { ProviderTab } from './SectionShell.js'
import { CodexSettingsPanel } from '../codex/CodexSettingsPanel.js'
import { AntigravitySettingsPanel } from '../antigravity/AntigravitySettingsPanel.js'
import { WorkBuddySettingsPanel } from '../workbuddy/WorkBuddySettingsPanel.js'
import { GrokSettingsPanel } from '../grok/GrokSettingsPanel.js'

/**
 * Build the tab list.
 *
 * `accounts` is accepted so a tab may tailor its copy to live state (for
 * example, hiding model pickers while signed out); today the pending panels do
 * not need it, but the signature keeps that option open without a later
 * refactor of every call site.
 *
 * @param _accounts - live account rows, currently unused by the pending panels.
 * @returns one tab per reverse-proxied provider, in display order.
 */
export function buildProviderTabs(_accounts: readonly ProviderAccount[]): readonly ProviderTab[] {
  return [
    {
      id: 'codex',
      label: 'Codex',
      render: () => <CodexSettingsPanel />,
    },
    {
      id: 'antigravity',
      label: 'Antigravity',
      render: () => <AntigravitySettingsPanel />,
    },
    {
      // WorkBuddy rides the desktop app's own session, so this plugin neither
      // starts nor ends one; its account row reports `canLogout: false`.
      id: 'workbuddy',
      label: 'WorkBuddy',
      render: () => <WorkBuddySettingsPanel />,
    },
    {
      id: 'grok',
      label: 'Grok',
      render: () => <GrokSettingsPanel />,
    },
  ]
}
