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
/**
 * Whether an adapter can run a login flow.
 *
 * The UI asks this instead of testing `id`, so a provider that gains or loses a
 * login flow changes its rendered controls with no view edit.
 * @param adapter - the adapter to inspect.
 * @returns true when both login halves are present.
 */
export function canLogin(adapter) {
    return adapter.beginLogin !== undefined && adapter.pollLogin !== undefined;
}
/**
 * Whether an adapter can end the current session.
 * @param adapter - the adapter to inspect.
 * @returns true when a logout is available.
 */
export function canLogout(adapter) {
    return adapter.logout !== undefined;
}
//# sourceMappingURL=contract.js.map