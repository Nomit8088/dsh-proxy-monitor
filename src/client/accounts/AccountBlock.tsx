/**
 * The shared account block: one login control for every provider.
 *
 * This is what makes four independently-built providers look like one feature.
 * Each provider differs in *what* it asks the user (nothing, a browser trip, a
 * device code, a CLI command), but not in *how* the answer is presented, so the
 * view switches on {@link LoginMethod.kind} and nothing else. No branch here
 * names a provider id.
 *
 * Two rules the component holds to:
 *
 * - **Never render a control that cannot work.** A `none` method shows its
 *   reason; a missing callback hides the button. The user is told what to do
 *   instead of being given a button that errors.
 * - **Never show a secret.** Every field rendered here (account, code, URL) is
 *   a value the user is meant to see; a token reaching this component would be
 *   a bug in the adapter beneath it, not something to mask here.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/accounts/AccountBlock
 */

import { useState, type ReactNode } from 'react'

import type { LoginMethod, ProviderAccount } from '../../accounts/contract.js'
import css from './AccountBlock.module.css'

/**
 * What one account row can do, supplied by the caller so this component stays
 * free of transport concerns (the rail and the settings page share it).
 */
export interface AccountActions {
  /** Start a login; the caller owns the polling loop. */
  onLogin(id: ProviderAccount['id']): void
  /** End a session. */
  onLogout(id: ProviderAccount['id']): void
  /** Which provider currently has a login in flight, if any. */
  busyId?: ProviderAccount['id'] | undefined
  /** The live instruction for an in-flight login, when the caller has one. */
  ticket?: { id: ProviderAccount['id']; method: LoginMethod } | undefined
}

/** A short human state label. */
function stateLabel(account: ProviderAccount): string {
  if (account.state === 'signed-in') return '已登录'
  if (account.state === 'signed-out') return '未登录'
  return '异常'
}

/**
 * Render the instruction half of one login method.
 *
 * Extracted so both the "start a login" button and the "login in flight" panel
 * describe the method identically — otherwise the two drift the first time a
 * method gains a field.
 *
 * @param method - the method to describe.
 * @returns the instruction element.
 */
function LoginInstruction({ method }: { method: LoginMethod }): ReactNode {
  if (method.kind === 'none') return <span className={css.hint}>{method.reason}</span>

  if (method.kind === 'cli') {
    return (
      <span className={css.instruction}>
        在终端运行 <code className={css.code}>{method.command}</code>
      </span>
    )
  }

  if (method.kind === 'device-request') {
    // The code does not exist yet: the button below asks the provider for one.
    // Naming the CLI as an *alternative* is honest here precisely because it is
    // not what the button does.
    return (
      <span className={css.instruction}>
        点击「登录」获取设备码。
        {method.cliCommand !== undefined && (
          <>
            {' '}也可在终端运行 <code className={css.code}>{method.cliCommand}</code>。
          </>
        )}
      </span>
    )
  }

  if (method.kind === 'device') {
    return (
      <span className={css.instruction}>
        打开{' '}
        <a className={css.link} href={method.verificationUri} target="_blank" rel="noreferrer">
          {method.verificationUri}
        </a>{' '}
        并输入 <code className={css.code}>{method.userCode}</code>
      </span>
    )
  }

  // Browser flow. `url` may be absent before the host has minted the page.
  if (method.url === undefined) {
    return <span className={css.hint}>等待授权页…</span>
  }
  return (
    <span className={css.instruction}>
      在{' '}
      <a className={css.link} href={method.url} target="_blank" rel="noreferrer">
        授权页
      </a>{' '}
      完成登录
    </span>
  )
}

/** Props of the account block. */
export interface AccountBlockProps extends AccountActions {
  account: ProviderAccount
}

/**
 * One provider's account row: identity, state, and the controls that change it.
 * @param props - the account plus its actions.
 * @returns the account block element.
 */
export function AccountBlock(props: AccountBlockProps): ReactNode {
  const { account, onLogin, onLogout, busyId, ticket } = props
  const [expanded, setExpanded] = useState(false)

  const busy = busyId === account.id
  const activeTicket = ticket !== undefined && ticket.id === account.id ? ticket.method : undefined
  const signedIn = account.state === 'signed-in'
  // A `none` method means the provider's session is not ours to start; showing a
  // button would promise something this plugin cannot deliver.
  const canStart = account.login.kind !== 'none'

  return (
    <div className={css.block} data-state={account.state}>
      <div className={css.head}>
        <span className={css.identity}>
          <span className={css.name}>{account.name}</span>
          {account.account !== undefined && <span className={css.account}>{account.account}</span>}
        </span>
        <span className={css.badge} data-state={account.state}>
          {stateLabel(account)}
        </span>
      </div>

      <div className={css.body}>
        {activeTicket !== undefined ? (
          <span className={css.pending}>
            <span className={css.spinner} aria-hidden="true" />
            <LoginInstruction method={activeTicket} />
          </span>
        ) : (
          <>
            {signedIn && account.login.kind !== 'none' && (
              <span className={css.hint}>凭证有效，额度读取无需再次登录。</span>
            )}
            {!signedIn && <LoginInstruction method={account.login} />}
          </>
        )}

        {account.error !== undefined && (
          <button type="button" className={css.errorToggle} onClick={() => { setExpanded(v => !v) }}>
            {expanded ? '隐藏详情' : `详情：${account.error.slice(0, 40)}${account.error.length > 40 ? '…' : ''}`}
          </button>
        )}
        {expanded && account.error !== undefined && <span className={css.errorDetail}>{account.error}</span>}
      </div>

      <div className={css.actions}>
        {/*
          The login control is offered whenever a flow exists — including while
          signed in. Gating it on `!signedIn` was the bug that made "log in"
          unreachable for an already-valid credential, which is exactly the state
          a user is in when they need to re-authenticate: a rotated token, a
          shared machine, or the wrong account. `canReauth` carries that decision
          from the adapter rather than being guessed from `state`.
        */}
        {canStart && (!signedIn || account.canReauth) && (
          <button
            type="button"
            className={signedIn ? css.buttonQuiet : css.button}
            disabled={busy}
            onClick={() => { onLogin(account.id) }}
          >
            {busy ? '进行中…' : signedIn ? '重新登录' : '登录'}
          </button>
        )}
        {signedIn && account.canLogout && (
          <button
            type="button"
            className={css.buttonQuiet}
            disabled={busy}
            onClick={() => { onLogout(account.id) }}
          >
            退出登录
          </button>
        )}
      </div>
    </div>
  )
}
