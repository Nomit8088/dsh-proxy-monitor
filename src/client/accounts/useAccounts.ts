/**
 * React binding for {@link AccountStore}.
 *
 * Kept apart from the store so the store stays a plain observable — testable
 * without a renderer, and the same object the slot framework's contract
 * expects. This file is the only place that knows the store is read by React.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/accounts/useAccounts
 */

import { useEffect, useState } from 'react'

import type { AccountState, AccountStore } from './store.js'

/**
 * Subscribe a component to the account store.
 *
 * Re-reads on mount as well as on publish: a component that mounts after the
 * first read would otherwise render `loading: true` forever, because no further
 * publish is coming until something else changes.
 *
 * @param store - the store to bind.
 * @returns the live account state.
 */
export function useAccounts(store: AccountStore): AccountState {
  const [state, setState] = useState<AccountState>(() => store.getSnapshot())
  useEffect(() => {
    setState(store.getSnapshot())
    // Kick a read on mount so a surface opened later (the settings page) shows
    // real state instead of an indefinite spinner.
    void store.refresh()
    return store.subscribe(() => {
      setState(store.getSnapshot())
    })
  }, [store])
  return state
}
