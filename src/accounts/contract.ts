/**
 * The unified account face shared by every reverse-proxied provider.
 *
 * The four providers this plugin fronts were built independently and disagree
 * about almost everything below the surface: where the credential lives, how it
 * is refreshed, whether a login is even possible, and what the upstream quota
 * endpoint is called. That is inherent — it is the providers' own shape — and
 * this module deliberately does **not** try to flatten it.
 *
 * What it does flatten is the **capability surface the UI talks to**. Every
 * provider, however different its plumbing, can answer three questions:
 *
 * 1. *Is there a usable credential, and whose is it?* → {@link ProviderAccount}
 * 2. *If not, what must the user do?* → {@link LoginMethod}
 * 3. *What is the current allowance?* → the existing `ProviderQuota`
 *
 * Because the UI binds to those three answers instead of to four bespoke
 * settings pages, one rail card and one login control work for all of them. The
 * per-provider differences survive as *data* (`login.kind`, `account`, `plan`)
 * rather than as branches in the view.
 *
 * **Secret boundary**: everything here is value-free by construction. An
 * account is an identity fact (an email or nickname), never a token; a login
 * instruction is a URL or a display code the user retypes, never a credential.
 * A token that reached this module would be a bug in the adapter beneath it.
 *
 * @module @dsh-external/dsh-proxy-monitor/accounts/contract
 */

import type { ProviderQuota } from '../contract.js'

/**
 * The providers that are *reverse-proxied*, as opposed to merely metered.
 *
 * DeepSeek and Claude are read-only rows in the rail: they report a balance or
 * a window and have no session this plugin owns. These four are the ones with a
 * subscription behind them and therefore a credential to manage, which is the
 * whole reason this module exists. Narrowing the id here means an adapter for a
 * quota-only provider is a type error rather than a runtime surprise.
 */
export type ProxiedProviderId = 'codex' | 'antigravity' | 'workbuddy' | 'grok'

/**
 * Whether a provider currently has a usable credential.
 *
 * Three states rather than a boolean because "no credential" and "the
 * credential is there but broken" need different words in the UI: the first
 * offers a login button, the second offers a diagnosis. Collapsing them would
 * show "sign in" to a user who is already signed in.
 */
export type AuthState = 'signed-in' | 'signed-out' | 'error'

/**
 * A provider with no login step at all.
 *
 * WorkBuddy is the only such provider: it rides the WorkBuddy desktop app's own
 * sign-in, so DSH can neither start nor end that session. The UI shows the
 * reason instead of a button, because offering a control that cannot work is
 * worse than offering none.
 */
export interface NoLoginMethod {
  kind: 'none'
  /** Why no login is possible, phrased for the user. */
  reason: string
}

/**
 * A login the user finishes in a browser.
 *
 * Covers both providers that open an authorization page in the user's browser
 * and complete through a loopback callback (Codex, Antigravity). Those two
 * differ in *which* page and how the callback is received, but not in what the
 * user is asked to do.
 */
export interface BrowserLoginMethod {
  kind: 'browser'
  /** Authorization page to open, when the host has minted one. */
  url?: string
  /**
   * True once the host is listening for the callback, which is when the UI
   * should say "waiting for the browser" rather than "click to sign in".
   */
  pending: boolean
}

/**
 * An RFC 8628 device-code login.
 *
 * Grok's secondary flow: the host asks the provider for a code, the user
 * retypes that code on the provider's site, and the host polls until the
 * provider confirms. The UI must be able to render the code and the link
 * together, which is why they travel as one structure.
 */
export interface DeviceLoginMethod {
  kind: 'device'
  /** Short code the user retypes on the verification page. */
  userCode: string
  /** Absolute HTTPS page the user opens to enter `userCode`. */
  verificationUri: string
  /** ISO timestamp after which the code is dead and a new one is required. */
  expiresAt: string
}

/**
 * A login delegated to a provider CLI.
 *
 * Grok's primary flow: the official `grok` CLI owns the whole PKCE dance, so
 * the host can only tell the user which command to run.
 */
export interface CliLoginMethod {
  kind: 'cli'
  /** Exact command the user must run. */
  command: string
}

/**
 * A device-code login that has not been requested yet.
 *
 * The code does not exist until the Host asks the provider for one, so this is
 * the state *before* {@link DeviceLoginMethod}: the UI says a code will be
 * shown once the user asks for it. Modelling it separately matters because the
 * alternative — describing the idle state as a CLI command — tells the user to
 * do something the button will not do.
 */
export interface DeviceRequestLoginMethod {
  kind: 'device-request'
  /**
   * Optional equivalent CLI command, when the provider's official CLI is
   * installed. Rendered as a secondary hint ("or run …"), never as the primary
   * instruction, because the button does not run it.
   */
  cliCommand?: string
}

/** Every way a provider can ask the user to sign in. */
export type LoginMethod =
  | NoLoginMethod
  | BrowserLoginMethod
  | DeviceLoginMethod
  | DeviceRequestLoginMethod
  | CliLoginMethod

/**
 * One provider's account state, as the browser sees it.
 *
 * This is the unit the rail's account block and the settings page both render;
 * neither needs to know which provider produced it.
 */
export interface ProviderAccount {
  id: ProxiedProviderId
  /** Display name matching the rail's provider row, e.g. "Codex". */
  name: string
  /** Identity fact (email / nickname) when the provider exposes one; never a token. */
  account?: string
  /** Whether a usable credential exists right now. */
  state: AuthState
  /** What the user must do to reach `signed-in`; `kind: 'none'` when nothing can be done. */
  login: LoginMethod
  /**
   * Whether this provider's session can be ended from here.
   *
   * Capability travels with the row rather than being inferred from the
   * provider's identity, because the two are genuinely independent: WorkBuddy
   * rides the desktop app's session, so it can be signed in yet has no logout
   * this plugin owns. A view that decided this from `id` would offer WorkBuddy a
   * button that does nothing, and would silently start doing so for any provider
   * that gained or lost a logout.
   */
  canLogout: boolean
  /**
   * Whether a *signed-in* provider may still start a login again.
   *
   * Distinct from the login method's presence, because being able to sign in and
   * wanting to offer that while already signed in are different questions. A
   * credential can be valid but bound to the wrong account (a shared machine, an
   * expired-but-unrefreshed token, a user who signed in with another identity),
   * and with no way to re-run the flow the only recovery is to find and delete
   * the credential file by hand.
   */
  canReauth: boolean
  /** Why the state is not `signed-in`; present exactly when it is not. */
  error?: string
}

/**
 * One in-flight login, as the browser polls it.
 *
 * `beginLogin` and `pollLogin` both answer this shape so the UI has one code
 * path: it renders `method` and stops polling once `done` is true.
 */
export interface LoginTicket {
  /** Opaque correlation id minted by `beginLogin` and echoed to `pollLogin`. */
  id: string
  /** What to show the user for this attempt (device code, URL, CLI command). */
  method: LoginMethod
  /**
   * Whether the flow has settled. On true the caller should re-read
   * {@link AccountAdapter.account} rather than trust this ticket's method.
   */
  done: boolean
  /** Set when the attempt failed; the user may start a new one. */
  error?: string
}

/**
 * One provider's unified capability face.
 *
 * Every reverse-proxied provider implements exactly this, and nothing above it
 * reads any other member. The optional methods are absent for providers that
 * genuinely cannot perform them (WorkBuddy has neither login nor logout), which
 * lets the UI hide a control by capability rather than by provider id — a
 * distinction that matters the moment a fifth provider is added.
 *
 * `quota()` is part of this interface rather than a separate reader table so a
 * provider's credential logic and its metering share one owner: the credential
 * that authorizes a quota read is the same one `account()` reports on, and
 * splitting them across two modules is how they drift.
 */
export interface AccountAdapter {
  /** The provider this adapter serves; must match its `ProviderQuota.id`. */
  readonly id: ProxiedProviderId
  /** Read the current account state. Must never throw; failures become `state: 'error'`. */
  account(): Promise<ProviderAccount>
  /** Start a login and return the instruction to display. Absent for no-login providers. */
  beginLogin?(): Promise<LoginTicket>
  /** Continue polling one login attempt. Present exactly when `beginLogin` is. */
  pollLogin?(ticketId: string): Promise<LoginTicket>
  /** End the session. Absent for providers whose session this plugin does not own. */
  logout?(): Promise<void>
  /** Read the current allowance. Must never throw; failures become an error row. */
  quota(): Promise<ProviderQuota>
}

/**
 * Whether an adapter can run a login flow.
 *
 * The UI asks this instead of testing `id`, so a provider that gains or loses a
 * login flow changes its rendered controls with no view edit.
 * @param adapter - the adapter to inspect.
 * @returns true when both login halves are present.
 */
export function canLogin(adapter: AccountAdapter): adapter is AccountAdapter &
  Required<Pick<AccountAdapter, 'beginLogin' | 'pollLogin'>> {
  return adapter.beginLogin !== undefined && adapter.pollLogin !== undefined
}

/**
 * Whether an adapter can end the current session.
 * @param adapter - the adapter to inspect.
 * @returns true when a logout is available.
 */
export function canLogout(adapter: AccountAdapter): adapter is AccountAdapter &
  Required<Pick<AccountAdapter, 'logout'>> {
  return adapter.logout !== undefined
}
