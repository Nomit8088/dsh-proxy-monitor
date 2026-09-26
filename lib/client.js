window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-proxy-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/contract.ts
		/**
		* Wire contract shared by the Host and browser halves of dsh-proxy-monitor.
		*
		* Everything here is JSON-safe and secret-free: the Host resolves credentials
		* and reaches the provider APIs, and only normalized quota numbers ever cross
		* the plugin-owned Connection RPC channel to the browser.
		*
		* @module @dsh-external/dsh-proxy-monitor/contract
		*/
		/**
		* Browser-facing route carrying this plugin's own endpoints.
		*
		* These are exact Fetch routes on Connection's shared, authenticated `/api`
		* channel (`connection.fetch.register`), the same mechanism the shipped file
		* and upload routes use. Connection's per-plugin `rpc.handle(channel, …)` is
		* *not* usable in this DSH generation: its implementation registers the channel
		* through `owner.webServer`, and that access fails inside the service no matter
		* which services the caller injects, so no route is ever mounted (the browser
		* sees `HTTP 405`). A plugin-owned route on the shared channel gets the platform
		* Host/Origin fence and browser authentication for free, so the endpoints below
		* are reached with one ordinary same-origin POST each.
		*/
		const PROXY_MONITOR_ROUTE = "/api/proxy-monitor";
		/**
		* Loader entry id of this plugin, and with it the identity of its settings.
		*
		* The settings seam addresses editable configuration by the id of the profile
		* entry that owns it — one form per entry, projected from that entry's own
		* `.volatile()` Config fields. Both halves therefore bind to this one string:
		* the Host declares the schema, and the browser reads and writes the form of
		* this entry.
		*/
		const PROXY_MONITOR_ENTRY = "dsh-proxy-monitor";
		//#endregion
		//#region src/client/api.ts
		/**
		* Browser-side caller for this plugin's own Host routes.
		*
		* The browser half never reads a credential and never talks to a vendor: it
		* asks the Host for a snapshot, and the Host answers numbers. This module is
		* the only place that knows the route and the endpoint names.
		*
		* The route is an exact POST route on Connection's shared, authenticated
		* `/api` channel, so one ordinary same-origin `fetch` reaches it — no RPC
		* client, no channel registration, and the platform's Host/Origin fence and
		* browser authentication are already applied on the Host side.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/api
		*/
		/** Unwrap a reply, turning a refusal into a thrown Error. */
		function unwrap(result) {
			if (!result.ok) throw new Error(result.error.message);
			return result.value;
		}
		/**
		* Build the transport over the page's own `fetch`.
		*
		* The route is document-relative (leading slash stripped) for the same reason
		* the platform's own caller does it: the shell may be mounted under a path
		* prefix, and a relative URL keeps that prefix.
		*
		* @param doFetch - transport override, for tests.
		* @returns the transport the broker and the account store share.
		*/
		function createProxyMonitorTransport(doFetch) {
			const send = doFetch ?? ((input, init) => globalThis.fetch(input, init));
			return { async post(endpoint, payload, signal) {
				const response = await send(`${PROXY_MONITOR_ROUTE}/${endpoint}`.slice(1), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new Error(`transport failure for ${PROXY_MONITOR_ROUTE}/${endpoint}: HTTP ${response.status}`);
				return await response.json();
			} };
		}
		/**
		* Build the snapshot broker over the plugin's transport.
		* @param transport - this plugin's same-origin routes.
		* @returns the broker the UI uses.
		*/
		function createQuotaBroker(transport) {
			return {
				async snapshot(signal) {
					return unwrap(await transport.post("snapshot", {}, signal));
				},
				async refresh(signal) {
					return unwrap(await transport.post("refresh", {}, signal));
				},
				async accounts(signal) {
					return unwrap(await transport.post("accounts", {}, signal));
				},
				async login(id, signal) {
					return unwrap(await transport.post("login", { id }, signal));
				},
				async pollLogin(id, ticketId, signal) {
					return unwrap(await transport.post("loginPoll", {
						id,
						ticketId
					}, signal));
				},
				async logout(id, signal) {
					return unwrap(await transport.post("logout", { id }, signal)).ok;
				}
			};
		}
		//#endregion
		//#region src/client/accounts/store.ts
		/** How often an in-flight login is polled, in milliseconds. */
		const LOGIN_POLL_MS = 2e3;
		/**
		* A device code and a browser callback both take a human a while; this bounds
		* the wait so a forgotten tab does not poll forever. Five minutes matches the
		* shortest expiry any provider's flow declares.
		*/
		const LOGIN_TIMEOUT_MS = 3e5;
		/**
		* The account store: subscription, reads, and the login lifecycle.
		*
		* The login lifecycle is the only stateful part. It is deliberately a single
		* slot (`busyId`) rather than a per-provider map: two logins cannot usefully run
		* at once, and a single slot makes "which ticket am I polling" unambiguous —
		* the bug that a map invites is polling ticket A while displaying ticket B.
		*/
		var AccountStore = class {
			broker;
			state = {
				accounts: [],
				loading: true
			};
			listeners = /* @__PURE__ */ new Set();
			/** Timer for the in-flight login poll, when one is active. */
			pollTimer;
			/** Epoch ms after which an in-flight login is abandoned. */
			deadline = 0;
			/** Guards against a late poll publishing after a newer login started. */
			generation = 0;
			/**
			* @param broker - the RPC broker this store reads and acts through.
			*/
			constructor(broker) {
				this.broker = broker;
			}
			/** The current state; identity is stable until a change is published. */
			getSnapshot() {
				return this.state;
			}
			/** Observe publishes. */
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/** Publish a partial change. */
			publish(patch) {
				this.state = {
					...this.state,
					...patch
				};
				for (const listener of this.listeners) listener();
			}
			/**
			* Read every account once.
			*
			* A failure sets the transport-level `error` but keeps the previous rows: a
			* transient RPC failure must not blank a page that was showing useful state.
			*
			* @param signal - optional cancellation.
			*/
			async refresh(signal) {
				try {
					const accounts = await this.broker.accounts(signal);
					this.publish({
						accounts,
						loading: false,
						error: void 0
					});
				} catch (error) {
					this.publish({
						loading: false,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}
			/**
			* Start a login and begin polling it.
			*
			* Polling stops on completion, on failure, and at the deadline; each publish
			* carries the ticket so the UI can render the code or link the provider
			* returned.
			*
			* @param id - provider to sign in to.
			*/
			async login(id) {
				this.stopPolling();
				const generation = ++this.generation;
				this.publish({
					busyId: id,
					error: void 0
				});
				try {
					const ticket = await this.broker.login(id);
					if (generation !== this.generation) return;
					this.publish({ ticket: {
						id,
						ticketId: ticket.id,
						method: ticket.method
					} });
					if (ticket.done) {
						await this.finishLogin(id, ticket);
						return;
					}
					this.deadline = Date.now() + LOGIN_TIMEOUT_MS;
					this.schedulePoll(id, ticket.id, generation);
				} catch (error) {
					if (generation !== this.generation) return;
					this.clearLogin(error instanceof Error ? error.message : String(error));
				}
			}
			/** Poll one ticket once, repeatedly, until it settles or the deadline passes. */
			schedulePoll(id, ticketId, generation) {
				this.pollTimer = window.setTimeout(() => {
					this.poll(id, ticketId, generation);
				}, LOGIN_POLL_MS);
			}
			/** One poll step. */
			async poll(id, ticketId, generation) {
				if (document.visibilityState !== "visible") {
					this.schedulePoll(id, ticketId, generation);
					return;
				}
				if (Date.now() > this.deadline) {
					this.clearLogin("登录等待超时，请重试。");
					return;
				}
				try {
					const ticket = await this.broker.pollLogin(id, ticketId);
					if (generation !== this.generation) return;
					this.publish({ ticket: {
						id,
						ticketId: ticket.id,
						method: ticket.method
					} });
					if (ticket.done) {
						await this.finishLogin(id, ticket);
						return;
					}
					if (ticket.error !== void 0) {
						this.clearLogin(ticket.error);
						return;
					}
					this.schedulePoll(id, ticketId, generation);
				} catch (error) {
					if (generation !== this.generation) return;
					this.clearLogin(error instanceof Error ? error.message : String(error));
				}
			}
			/** Adopt a settled ticket's outcome and re-read the account list. */
			async finishLogin(id, ticket) {
				this.stopPolling();
				await this.refresh();
				const stillOut = this.state.accounts.find((account) => account.id === id)?.state !== "signed-in";
				this.publish({
					busyId: void 0,
					ticket: void 0,
					...ticket.error === void 0 && !stillOut ? {} : { error: ticket.error ?? "登录未完成" }
				});
			}
			/** Abandon an in-flight login with a message. */
			clearLogin(message) {
				this.stopPolling();
				this.publish({
					busyId: void 0,
					ticket: void 0,
					error: message
				});
			}
			/** Cancel any pending poll. */
			stopPolling() {
				if (this.pollTimer !== void 0) {
					window.clearTimeout(this.pollTimer);
					this.pollTimer = void 0;
				}
			}
			/**
			* End one provider's session and re-read.
			* @param id - provider to sign out of.
			*/
			async logout(id) {
				this.stopPolling();
				this.generation += 1;
				try {
					await this.broker.logout(id);
				} catch (error) {
					this.publish({ error: error instanceof Error ? error.message : String(error) });
				}
				this.publish({
					busyId: void 0,
					ticket: void 0
				});
				await this.refresh();
			}
			/** Release the poll timer; call when the owning plugin unloads. */
			dispose() {
				this.generation += 1;
				this.stopPolling();
				this.listeners.clear();
			}
		};
		//#endregion
		//#region \0dsh-proxy-monitor-css:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor\src\client\accounts\AccountBlock.module.css.mjs
		const css$5 = ".mZIwIa_block{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3);border-radius:8px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}.mZIwIa_head{justify-content:space-between;align-items:baseline;gap:8px;display:flex}.mZIwIa_identity{align-items:baseline;gap:6px;min-width:0;display:flex}.mZIwIa_name{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}.mZIwIa_account{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;overflow:hidden}.mZIwIa_badge{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 6px;font-size:11px}.mZIwIa_badge[data-state=signed-in]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}.mZIwIa_badge[data-state=error]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}.mZIwIa_body{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;min-width:0;font-size:12px;display:flex}.mZIwIa_hint{color:var(--dsw-alias-label-tertiary)}.mZIwIa_instruction{color:var(--dsw-alias-label-secondary);word-break:break-word}.mZIwIa_pending{align-items:baseline;gap:6px;display:flex}.mZIwIa_spinner{border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;flex:none;width:10px;height:10px;animation:.9s linear infinite mZIwIa_dsh-pm-account-spin}@keyframes mZIwIa_dsh-pm-account-spin{to{transform:rotate(360deg)}}.mZIwIa_code{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:4px;padding:1px 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}.mZIwIa_link{color:var(--dsw-alias-brand-primary);text-decoration:none}.mZIwIa_link:hover{text-decoration:underline}.mZIwIa_errorToggle{cursor:pointer;color:var(--dsw-alias-state-error-primary);text-align:left;background:0 0;border:none;align-self:flex-start;padding:0;font-size:11px}.mZIwIa_errorDetail{color:var(--dsw-alias-label-tertiary);word-break:break-word;font-size:11px}.mZIwIa_actions{gap:8px;display:flex}.mZIwIa_button{border:1px solid var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;padding:3px 12px;font-size:12px}.mZIwIa_button:disabled{opacity:.6;cursor:default}.mZIwIa_buttonQuiet{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:6px;padding:3px 12px;font-size:12px}.mZIwIa_buttonQuiet:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.mZIwIa_buttonQuiet:disabled{opacity:.6;cursor:default}";
		const styleId$5 = "@dsh-external/dsh-proxy-monitor/AccountBlock.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$5) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@dsh-external/dsh-proxy-monitor";
			style.dataset.pluginCss = styleId$5;
			style.textContent = css$5;
			document.head.appendChild(style);
		}
		var AccountBlock_module_css_default = {
			"body": "mZIwIa_body",
			"dsh-pm-account-spin": "mZIwIa_dsh-pm-account-spin",
			"code": "mZIwIa_code",
			"head": "mZIwIa_head",
			"errorDetail": "mZIwIa_errorDetail",
			"errorToggle": "mZIwIa_errorToggle",
			"name": "mZIwIa_name",
			"account": "mZIwIa_account",
			"button": "mZIwIa_button",
			"pending": "mZIwIa_pending",
			"actions": "mZIwIa_actions",
			"link": "mZIwIa_link",
			"block": "mZIwIa_block",
			"instruction": "mZIwIa_instruction",
			"hint": "mZIwIa_hint",
			"identity": "mZIwIa_identity",
			"badge": "mZIwIa_badge",
			"buttonQuiet": "mZIwIa_buttonQuiet",
			"spinner": "mZIwIa_spinner"
		};
		//#endregion
		//#region src/client/accounts/AccountBlock.tsx
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
		/** A short human state label. */
		function stateLabel(account) {
			if (account.state === "signed-in") return "已登录";
			if (account.state === "signed-out") return "未登录";
			return "异常";
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
		function LoginInstruction({ method }) {
			if (method.kind === "none") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: AccountBlock_module_css_default.hint,
				children: method.reason
			});
			if (method.kind === "cli") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: AccountBlock_module_css_default.instruction,
				children: ["在终端运行 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
					className: AccountBlock_module_css_default.code,
					children: method.command
				})]
			});
			if (method.kind === "device-request") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: AccountBlock_module_css_default.instruction,
				children: ["点击「登录」获取设备码。", method.cliCommand !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					" ",
					"也可在终端运行 ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						className: AccountBlock_module_css_default.code,
						children: method.cliCommand
					}),
					"。"
				] })]
			});
			if (method.kind === "device") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: AccountBlock_module_css_default.instruction,
				children: [
					"打开",
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						className: AccountBlock_module_css_default.link,
						href: method.verificationUri,
						target: "_blank",
						rel: "noreferrer",
						children: method.verificationUri
					}),
					" ",
					"并输入 ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						className: AccountBlock_module_css_default.code,
						children: method.userCode
					})
				]
			});
			if (method.url === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: AccountBlock_module_css_default.hint,
				children: "等待授权页…"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: AccountBlock_module_css_default.instruction,
				children: [
					"在",
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						className: AccountBlock_module_css_default.link,
						href: method.url,
						target: "_blank",
						rel: "noreferrer",
						children: "授权页"
					}),
					" ",
					"完成登录"
				]
			});
		}
		/**
		* One provider's account row: identity, state, and the controls that change it.
		* @param props - the account plus its actions.
		* @returns the account block element.
		*/
		function AccountBlock(props) {
			const { account, onLogin, onLogout, busyId, ticket } = props;
			const [expanded, setExpanded] = (0, react.useState)(false);
			const busy = busyId === account.id;
			const activeTicket = ticket !== void 0 && ticket.id === account.id ? ticket.method : void 0;
			const signedIn = account.state === "signed-in";
			const canStart = account.login.kind !== "none";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: AccountBlock_module_css_default.block,
				"data-state": account.state,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: AccountBlock_module_css_default.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: AccountBlock_module_css_default.identity,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: AccountBlock_module_css_default.name,
								children: account.name
							}), account.account !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: AccountBlock_module_css_default.account,
								children: account.account
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AccountBlock_module_css_default.badge,
							"data-state": account.state,
							children: stateLabel(account)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: AccountBlock_module_css_default.body,
						children: [
							activeTicket !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: AccountBlock_module_css_default.pending,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: AccountBlock_module_css_default.spinner,
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoginInstruction, { method: activeTicket })]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [signedIn && account.login.kind !== "none" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: AccountBlock_module_css_default.hint,
								children: "凭证有效，额度读取无需再次登录。"
							}), !signedIn && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoginInstruction, { method: account.login })] }),
							account.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: AccountBlock_module_css_default.errorToggle,
								onClick: () => {
									setExpanded((v) => !v);
								},
								children: expanded ? "隐藏详情" : `详情：${account.error.slice(0, 40)}${account.error.length > 40 ? "…" : ""}`
							}),
							expanded && account.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: AccountBlock_module_css_default.errorDetail,
								children: account.error
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: AccountBlock_module_css_default.actions,
						children: [canStart && (!signedIn || account.canReauth) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: signedIn ? AccountBlock_module_css_default.buttonQuiet : AccountBlock_module_css_default.button,
							disabled: busy,
							onClick: () => {
								onLogin(account.id);
							},
							children: busy ? "进行中…" : signedIn ? "重新登录" : "登录"
						}), signedIn && account.canLogout && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: AccountBlock_module_css_default.buttonQuiet,
							disabled: busy,
							onClick: () => {
								onLogout(account.id);
							},
							children: "退出登录"
						})]
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-proxy-monitor-css:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor\src\client\accounts\QuotaPanel.module.css.mjs
		const css$4 = ".SnZIsG_panel{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;flex-direction:column;gap:10px;padding:12px;display:flex}.SnZIsG_head{align-items:baseline;gap:10px;display:flex}.SnZIsG_title{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600}.SnZIsG_freshness{color:var(--dsw-alias-label-tertiary);flex:1;font-size:11px}.SnZIsG_refresh{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:6px;padding:3px 10px;font-size:12px}.SnZIsG_refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.SnZIsG_refresh:disabled{opacity:.6;cursor:default}.SnZIsG_plan,.SnZIsG_account,.SnZIsG_balance{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}.SnZIsG_balance{color:var(--dsw-alias-label-primary)}.SnZIsG_windows{flex-direction:column;gap:10px;display:flex}.SnZIsG_window{flex-direction:column;gap:4px;display:flex}.SnZIsG_windowHead{justify-content:space-between;align-items:baseline;gap:8px;display:flex}.SnZIsG_windowLabel{color:var(--dsw-alias-label-primary);font-size:12px}.SnZIsG_windowMeta{color:var(--dsw-alias-label-tertiary);font-size:11px}.SnZIsG_bar{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:3px;height:6px;overflow:hidden}.SnZIsG_barFill{background:var(--dsw-alias-state-success-primary);border-radius:3px;height:100%}.SnZIsG_bar[data-level=warn] .SnZIsG_barFill{background:var(--dsw-alias-state-warn-primary)}.SnZIsG_bar[data-level=danger] .SnZIsG_barFill{background:var(--dsw-alias-state-error-primary)}.SnZIsG_barCaption{color:var(--dsw-alias-label-secondary);justify-content:space-between;align-items:baseline;gap:8px;font-size:11px;display:flex}.SnZIsG_absolute{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}.SnZIsG_balanceLine{color:var(--dsw-alias-label-primary);font-size:12px}.SnZIsG_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.SnZIsG_notice{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;flex-direction:column;gap:2px;padding:8px 10px;display:flex}.SnZIsG_notice[data-tone=unconfigured]{border-color:var(--dsw-alias-border-l2)}.SnZIsG_notice[data-tone=error]{border-color:var(--dsw-alias-state-error-primary)}.SnZIsG_noticeTitle{color:var(--dsw-alias-label-primary);font-size:12px}.SnZIsG_notice[data-tone=error] .SnZIsG_noticeTitle{color:var(--dsw-alias-state-error-primary)}.SnZIsG_noticeDetail{color:var(--dsw-alias-label-tertiary);word-break:break-word;font-size:11px}";
		const styleId$4 = "@dsh-external/dsh-proxy-monitor/QuotaPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$4) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@dsh-external/dsh-proxy-monitor";
			style.dataset.pluginCss = styleId$4;
			style.textContent = css$4;
			document.head.appendChild(style);
		}
		var QuotaPanel_module_css_default = {
			"window": "SnZIsG_window",
			"notice": "SnZIsG_notice",
			"bar": "SnZIsG_bar",
			"windowHead": "SnZIsG_windowHead",
			"head": "SnZIsG_head",
			"account": "SnZIsG_account",
			"noticeDetail": "SnZIsG_noticeDetail",
			"absolute": "SnZIsG_absolute",
			"windowMeta": "SnZIsG_windowMeta",
			"balance": "SnZIsG_balance",
			"panel": "SnZIsG_panel",
			"windows": "SnZIsG_windows",
			"barCaption": "SnZIsG_barCaption",
			"balanceLine": "SnZIsG_balanceLine",
			"freshness": "SnZIsG_freshness",
			"noticeTitle": "SnZIsG_noticeTitle",
			"plan": "SnZIsG_plan",
			"refresh": "SnZIsG_refresh",
			"windowLabel": "SnZIsG_windowLabel",
			"barFill": "SnZIsG_barFill",
			"empty": "SnZIsG_empty",
			"title": "SnZIsG_title"
		};
		//#endregion
		//#region src/client/accounts/QuotaPanel.tsx
		/** Above this consumed share a row turns amber; above the second, red. */
		const WARN_AT$1 = 75;
		const DANGER_AT$1 = 90;
		/** The severity class of one metered row. */
		function levelOf$1(usedPercent) {
			if (usedPercent === void 0) return "idle";
			if (usedPercent >= DANGER_AT$1) return "danger";
			if (usedPercent >= WARN_AT$1) return "warn";
			return "ok";
		}
		/** "in 51 min" — what a user actually wants from a reset time. */
		function relativeReset$1(resetAt, now) {
			if (resetAt === void 0) return void 0;
			const at = Date.parse(resetAt);
			if (!Number.isFinite(at)) return void 0;
			const deltaMs = at - now;
			if (deltaMs <= 0) return "即将重置";
			const minutes = Math.round(deltaMs / 6e4);
			if (minutes < 60) return `${String(minutes)} 分钟后重置`;
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return `${String(hours)} 小时后重置`;
			return `${String(Math.round(hours / 24))} 天后重置`;
		}
		/** One metered window. */
		function WindowRow$1({ entry, now }) {
			const used = entry.usedPercent;
			const relative = relativeReset$1(entry.resetAt, now);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: QuotaPanel_module_css_default.window,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuotaPanel_module_css_default.windowHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: QuotaPanel_module_css_default.windowLabel,
						children: entry.label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: QuotaPanel_module_css_default.windowMeta,
						children: relative ?? entry.detail ?? ""
					})]
				}), used === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: QuotaPanel_module_css_default.balanceLine,
					children: entry.detail ?? "—"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: QuotaPanel_module_css_default.bar,
					"data-level": levelOf$1(used),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaPanel_module_css_default.barFill,
						style: { width: `${String(Math.min(100, Math.max(0, used)))}%` }
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuotaPanel_module_css_default.barCaption,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [String(Math.round(used)), "% 已用"] }), entry.resetAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: QuotaPanel_module_css_default.absolute,
						children: new Date(entry.resetAt).toLocaleString()
					})]
				})] })]
			});
		}
		/**
		* The quota panel for one provider.
		* @param props - the provider's row plus refresh wiring.
		* @returns the panel element.
		*/
		function QuotaPanel(props) {
			const { quota, refreshing, snapshotAt, onRefresh } = props;
			const now = Date.now();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: QuotaPanel_module_css_default.panel,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuotaPanel_module_css_default.head,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: QuotaPanel_module_css_default.title,
							children: "额度"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: QuotaPanel_module_css_default.freshness,
							children: snapshotAt === void 0 ? "尚未读取" : `读取于 ${new Date(snapshotAt).toLocaleTimeString()}`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: QuotaPanel_module_css_default.refresh,
							onClick: onRefresh,
							disabled: refreshing,
							title: "立即重新读取全部提供商的额度",
							children: refreshing ? "刷新中…" : "刷新额度"
						})
					]
				}), quota === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: QuotaPanel_module_css_default.empty,
					children: "正在读取…"
				}) : quota.status === "ok" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					quota.plan !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: QuotaPanel_module_css_default.plan,
						children: quota.plan
					}),
					quota.account !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: QuotaPanel_module_css_default.account,
						children: quota.account
					}),
					quota.balance !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: QuotaPanel_module_css_default.balance,
						children: ["余额：", quota.balance]
					}),
					quota.windows.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaPanel_module_css_default.windows,
						children: quota.windows.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WindowRow$1, {
							entry,
							now
						}, entry.id))
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: QuotaPanel_module_css_default.empty,
						children: "该提供商未报告可计量的额度窗口。"
					})
				] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuotaPanel_module_css_default.notice,
					"data-tone": quota.status,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: QuotaPanel_module_css_default.noticeTitle,
						children: quota.status === "unconfigured" ? "未登录 / 未配置" : "读取失败"
					}), quota.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: QuotaPanel_module_css_default.noticeDetail,
						children: quota.error
					})]
				})]
			});
		}
		//#endregion
		//#region \0dsh-proxy-monitor-css:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor\src\client\accounts\SectionShell.module.css.mjs
		const css$3 = ".bF_rpG_shell{flex-direction:column;gap:14px;display:flex}.bF_rpG_header{flex-direction:column;gap:4px;display:flex}.bF_rpG_heading{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:600}.bF_rpG_lead{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.6}.bF_rpG_transportError{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:6px;padding:6px 10px;font-size:12px}.bF_rpG_tabs{border-bottom:1px solid var(--dsw-alias-border-l1);gap:2px;display:flex}.bF_rpG_tab{cursor:pointer;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-bottom:2px solid #0000;margin-bottom:-1px;padding:6px 12px;font-size:13px;position:relative}.bF_rpG_tab:hover{color:var(--dsw-alias-label-secondary)}.bF_rpG_tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}.bF_rpG_tab[data-state=signed-in]:after,.bF_rpG_tab[data-state=error]:after{content:\"\";vertical-align:middle;border-radius:50%;width:5px;height:5px;margin-left:6px;display:inline-block}.bF_rpG_tab[data-state=signed-in]:after{background:var(--dsw-alias-state-success-primary)}.bF_rpG_tab[data-state=error]:after{background:var(--dsw-alias-state-error-primary)}.bF_rpG_body{flex-direction:column;gap:12px;display:flex}.bF_rpG_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}";
		const styleId$3 = "@dsh-external/dsh-proxy-monitor/SectionShell.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$3) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@dsh-external/dsh-proxy-monitor";
			style.dataset.pluginCss = styleId$3;
			style.textContent = css$3;
			document.head.appendChild(style);
		}
		var SectionShell_module_css_default = {
			"lead": "bF_rpG_lead",
			"tab": "bF_rpG_tab",
			"heading": "bF_rpG_heading",
			"transportError": "bF_rpG_transportError",
			"body": "bF_rpG_body",
			"shell": "bF_rpG_shell",
			"header": "bF_rpG_header",
			"tabs": "bF_rpG_tabs",
			"empty": "bF_rpG_empty"
		};
		//#endregion
		//#region src/client/accounts/SectionShell.tsx
		/**
		* The settings shell: one nav entry whose body switches between providers.
		*
		* This is the "one entry, internal tabs" decision. The alternative — one
		* `settings.section` per provider — would put four or five rows in the Settings
		* nav, each a differently-styled page from a different upstream project. The
		* shell instead owns the nav row, the provider switch, and the shared account
		* block, and each provider contributes only its own *specific* fields as tab
		* content.
		*
		* The split matters because it puts every provider difference in one place
		* (a tab's children) and every provider similarity in another (this file plus
		* {@link AccountBlock}), so a new provider adds a tab without restyling a page.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/accounts/SectionShell
		*/
		/**
		* The settings shell.
		* @param props - tabs, live accounts and quotas, and the shared actions.
		* @returns the shell element.
		*/
		function SectionShell(props) {
			const { tabs, accounts, quotas, loading, refreshing, transportError, snapshotAt, onRefreshQuota, ...actions } = props;
			const [activeId, setActiveId] = (0, react.useState)(tabs[0]?.id);
			const byId = new Map(accounts.map((account) => [account.id, account]));
			const quotaById = new Map(quotas.map((quota) => [quota.id, quota]));
			const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SectionShell_module_css_default.shell,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: SectionShell_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: SectionShell_module_css_default.heading,
							children: "订阅反代"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: SectionShell_module_css_default.lead,
							children: "把各家的订阅账号接入 DSH，并在侧栏圆环中显示额度消耗。登录状态与额度读取共用同一份凭证。"
						})]
					}),
					transportError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SectionShell_module_css_default.transportError,
						children: ["状态读取失败：", transportError]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
						className: SectionShell_module_css_default.tabs,
						role: "tablist",
						"aria-label": "提供商",
						children: tabs.map((tab) => {
							const account = byId.get(tab.id);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "tab",
								className: SectionShell_module_css_default.tab,
								"data-active": tab.id === active?.id ? "true" : void 0,
								"data-state": account?.state ?? "unknown",
								"aria-selected": tab.id === active?.id,
								onClick: () => {
									setActiveId(tab.id);
								},
								children: tab.label
							}, tab.id);
						})
					}),
					active === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SectionShell_module_css_default.empty,
						children: "此构建未包含任何反代提供商。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: SectionShell_module_css_default.body,
						role: "tabpanel",
						"aria-label": active.label,
						children: [
							loading && byId.get(active.id) === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SectionShell_module_css_default.empty,
								children: "正在读取登录状态…"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountBlock, {
								account: byId.get(active.id) ?? {
									id: active.id,
									name: active.label,
									state: "error",
									login: {
										kind: "none",
										reason: "account unavailable"
									},
									canLogout: false,
									canReauth: false,
									error: "account row missing from the last read"
								},
								...actions
							}),
							active.render(byId.get(active.id)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaPanel, {
								quota: quotaById.get(active.id),
								refreshing,
								snapshotAt,
								onRefresh: onRefreshQuota
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/accounts/useAccounts.ts
		/**
		* React binding for {@link AccountStore}.
		*
		* Kept apart from the store so the store stays a plain observable — testable
		* without a renderer, and the same object the slot framework's contract
		* expects. This file is the only place that knows the store is read by React.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/accounts/useAccounts
		*/
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
		function useAccounts(store) {
			const [state, setState] = (0, react.useState)(() => store.getSnapshot());
			(0, react.useEffect)(() => {
				setState(store.getSnapshot());
				store.refresh();
				return store.subscribe(() => {
					setState(store.getSnapshot());
				});
			}, [store]);
			return state;
		}
		//#endregion
		//#region \0dsh-proxy-monitor-css:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor\src\client\models\ModelCatalogPanel.module.css.mjs
		const css$2 = ".Ki-1Mq_panel{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;flex-direction:column;gap:10px;padding:12px;display:flex}.Ki-1Mq_head{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.Ki-1Mq_titleBlock{flex-direction:column;gap:3px;min-width:0;display:flex}.Ki-1Mq_title{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600}.Ki-1Mq_lead{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.6}.Ki-1Mq_actions{flex-wrap:wrap;flex-shrink:0;justify-content:flex-end;gap:6px;display:flex}.Ki-1Mq_button{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:6px;padding:3px 10px;font-size:12px}.Ki-1Mq_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.Ki-1Mq_button:disabled{opacity:.6;cursor:default}.Ki-1Mq_list{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;flex-direction:column;display:flex;overflow:hidden}.Ki-1Mq_row{border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);align-items:flex-start;gap:10px;padding:10px 12px;display:flex}.Ki-1Mq_row:first-child{border-top:0}.Ki-1Mq_row[data-enabled=false]{opacity:.62}.Ki-1Mq_check{flex:none;margin-top:2px}.Ki-1Mq_body{flex-direction:column;flex:auto;gap:2px;min-width:0;display:flex}.Ki-1Mq_name{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;overflow:hidden}.Ki-1Mq_meta{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.5;overflow:hidden}.Ki-1Mq_imageToggle{color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;flex:none;align-items:center;gap:6px;font-size:12px;display:flex}.Ki-1Mq_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:1.6}.Ki-1Mq_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.6}.Ki-1Mq_empty{color:var(--dsw-alias-label-tertiary);margin:0;padding:10px 12px;font-size:12px}";
		const styleId$2 = "@dsh-external/dsh-proxy-monitor/ModelCatalogPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$2) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@dsh-external/dsh-proxy-monitor";
			style.dataset.pluginCss = styleId$2;
			style.textContent = css$2;
			document.head.appendChild(style);
		}
		var ModelCatalogPanel_module_css_default = {
			"row": "Ki-1Mq_row",
			"meta": "Ki-1Mq_meta",
			"name": "Ki-1Mq_name",
			"titleBlock": "Ki-1Mq_titleBlock",
			"error": "Ki-1Mq_error",
			"panel": "Ki-1Mq_panel",
			"head": "Ki-1Mq_head",
			"note": "Ki-1Mq_note",
			"title": "Ki-1Mq_title",
			"empty": "Ki-1Mq_empty",
			"button": "Ki-1Mq_button",
			"imageToggle": "Ki-1Mq_imageToggle",
			"actions": "Ki-1Mq_actions",
			"list": "Ki-1Mq_list",
			"check": "Ki-1Mq_check",
			"body": "Ki-1Mq_body",
			"lead": "Ki-1Mq_lead"
		};
		//#endregion
		//#region src/client/models/ModelCatalogPanel.tsx
		/** Whether this option should declare image input to DSH. */
		function optionSupportsImages(option) {
			if (typeof option.supportsImages === "boolean") return option.supportsImages;
			return Array.isArray(option.inputModalities) && option.inputModalities.includes("image");
		}
		function optionMeta(option) {
			if (option.meta !== void 0 && option.meta.length > 0) return option.meta;
			const parts = [option.id];
			if (Array.isArray(option.reasoningEfforts) && option.reasoningEfforts.length > 0) parts.push(`thinking: ${option.reasoningEfforts.join("/")}`);
			if (typeof option.remainingPercent === "number") parts.push(`额度 ${String(option.remainingPercent)}%`);
			return parts.join(" · ");
		}
		function ModelRow({ option, busy, onToggleEnabled, onToggleImage }) {
			const supportsImages = optionSupportsImages(option);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ModelCatalogPanel_module_css_default.row,
				"data-enabled": option.enabled ? "true" : "false",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: ModelCatalogPanel_module_css_default.check,
						type: "checkbox",
						checked: option.enabled,
						disabled: busy,
						"aria-label": `在模型选择器中显示 ${option.name ?? option.id}`,
						onChange: (event) => {
							onToggleEnabled(option.id, event.target.checked);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ModelCatalogPanel_module_css_default.body,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ModelCatalogPanel_module_css_default.name,
							children: option.name ?? option.id
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ModelCatalogPanel_module_css_default.meta,
							children: optionMeta(option)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: ModelCatalogPanel_module_css_default.imageToggle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: supportsImages,
							disabled: busy,
							"aria-label": `${option.name ?? option.id} 支持图像`,
							onChange: (event) => {
								onToggleImage(option.id, event.target.checked);
							}
						}), "支持图像"]
					})
				]
			});
		}
		const DEFAULT_LEAD = "从当前账号动态拉取，而不是写死列表。勾选后出现在 DSH 模型选择器中；勾选「支持图像」后 DSH 不会把图片拦截成文本。";
		const DEFAULT_NOTE = "勾选即自动保存。重新打开模型选择器即可看到最新列表；运行中的旧会话不受影响。";
		/** Shared enable / image-support catalog used by every reverse-proxied provider. */
		function ModelCatalogPanel(props) {
			const { title = "可用模型", lead = DEFAULT_LEAD, note = DEFAULT_NOTE, empty, options, busy, error, onRefresh, onToggleEnabled, onToggleImage, onSetAllEnabled } = props;
			const emptyText = empty ?? (busy ? "正在加载模型…" : "暂无模型。登录后点击「刷新模型」从账号拉取。");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ModelCatalogPanel_module_css_default.panel,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ModelCatalogPanel_module_css_default.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ModelCatalogPanel_module_css_default.titleBlock,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: ModelCatalogPanel_module_css_default.title,
								children: title
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: ModelCatalogPanel_module_css_default.lead,
								children: lead
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ModelCatalogPanel_module_css_default.actions,
							children: [
								onRefresh === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelCatalogPanel_module_css_default.button,
									disabled: busy,
									onClick: onRefresh,
									children: busy ? "刷新中…" : "刷新模型"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelCatalogPanel_module_css_default.button,
									disabled: busy || options.length === 0,
									onClick: () => {
										onSetAllEnabled(true);
									},
									children: "全选"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelCatalogPanel_module_css_default.button,
									disabled: busy || options.length === 0,
									onClick: () => {
										onSetAllEnabled(false);
									},
									children: "全不选"
								})
							]
						})]
					}),
					options.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ModelCatalogPanel_module_css_default.empty,
						children: emptyText
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ModelCatalogPanel_module_css_default.list,
						role: "group",
						"aria-label": title,
						children: options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
							option,
							busy,
							onToggleEnabled,
							onToggleImage
						}, option.id))
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ModelCatalogPanel_module_css_default.error,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ModelCatalogPanel_module_css_default.note,
						children: note
					})
				]
			});
		}
		//#endregion
		//#region src/client/codex/OpenAICodexSettings.tsx
		/** Plugin-owned OpenAI Codex account page inside the dsh Settings shell. */
		const STATUS_PATH = "/plugins/dsh-openai-codex/auth/status";
		const LOGIN_PATH = "/plugins/dsh-openai-codex/auth/login";
		const LOGOUT_PATH = "/plugins/dsh-openai-codex/auth/logout";
		const IMAGE_TOOLS_PATH = "/plugins/dsh-openai-codex/image-tools";
		const RESPONSE_API_PATH = "/plugins/dsh-openai-codex/response-api";
		const MODEL_CATALOG_PATH = "/plugins/dsh-proxy-monitor/codex/models";
		const CONTEXT_WINDOW_PATH = "/plugins/dsh-openai-codex/context-window";
		const FAST_MODE_SETTINGS_PATH = "/plugins/dsh-openai-codex/fast-mode-default";
		const PROXY_PATH = "/plugins/dsh-openai-codex/proxy";
		const POLL_INTERVAL_MS = 1e3;
		const USAGE_POLL_INTERVAL_MS = 6e4;
		const pageStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			maxWidth: 720
		};
		const titleStyle = {
			margin: 0,
			fontSize: 20,
			lineHeight: "28px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const bodyStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const cardStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 14,
			padding: "18px 20px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			flexWrap: "wrap",
			gap: 12
		};
		const statusStyle = {
			display: "flex",
			alignItems: "center",
			gap: 9,
			fontSize: 15,
			fontWeight: 500,
			color: "var(--dsw-alias-label-primary)"
		};
		const buttonStyle = {
			boxSizing: "border-box",
			minHeight: 34,
			padding: "6px 14px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 18,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 14,
			cursor: "pointer"
		};
		const primaryButtonStyle = {
			...buttonStyle,
			borderColor: "var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		const errorStyle = {
			...bodyStyle,
			color: "var(--dsw-alias-state-error-primary)"
		};
		const quotaListStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			paddingTop: 2
		};
		const quotaGroupStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const quotaTitleStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const quotaLabelStyle = {
			display: "flex",
			justifyContent: "space-between",
			gap: 12,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const progressTrackStyle = {
			height: 8,
			overflow: "hidden",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08))"
		};
		const toggleRowStyle = {
			...rowStyle,
			flexWrap: "nowrap",
			alignItems: "flex-start"
		};
		const toggleCopyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 3
		};
		const toggleTrackStyle = {
			position: "relative",
			width: 40,
			height: 22,
			flex: "0 0 auto",
			marginTop: 1,
			padding: 0,
			border: 0,
			borderRadius: 999,
			cursor: "pointer",
			transition: "background 120ms ease"
		};
		const numberInputStyle = {
			boxSizing: "border-box",
			width: 180,
			minHeight: 36,
			padding: "7px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 14
		};
		const proxyModeStyle = {
			display: "grid",
			gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-1)",
			boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)"
		};
		const proxyModeButtonStyle = {
			boxSizing: "border-box",
			minWidth: 0,
			minHeight: 40,
			padding: "8px 12px",
			border: 0,
			borderRadius: 0,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			fontSize: 13,
			fontWeight: 600,
			cursor: "pointer",
			transition: "background 140ms ease, color 140ms ease"
		};
		const proxyInputStyle = {
			...numberInputStyle,
			width: "auto",
			flex: "1 1 320px",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			fontSize: 13
		};
		const commandStyle = {
			margin: 0,
			padding: "10px 12px",
			overflowX: "auto",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06))",
			color: "var(--dsw-alias-label-primary)",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			fontSize: 13,
			lineHeight: "20px",
			whiteSpace: "pre-wrap",
			overflowWrap: "anywhere"
		};
		function PreferenceToggle({ checked, disabled, label, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				role: "switch",
				"aria-checked": checked,
				"aria-label": label,
				disabled,
				style: {
					...toggleTrackStyle,
					opacity: disabled ? .55 : 1,
					background: checked ? "var(--dsw-alias-button-primary-fill)" : "var(--dsw-alias-bg-layer-2, #c8ccd2)"
				},
				onClick: () => {
					onChange(!checked);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
					position: "absolute",
					top: 3,
					left: checked ? 21 : 3,
					width: 16,
					height: 16,
					borderRadius: "50%",
					background: "var(--dsw-alias-label-primary-foreground)",
					boxShadow: "0 1px 3px rgba(0, 0, 0, 0.25)",
					transition: "left 120ms ease"
				} })
			});
		}
		function ProxyModeControl({ value, disabled, onChange, t }) {
			const options = [
				{
					value: "off",
					label: "proxyModeOff"
				},
				{
					value: "scoped",
					label: "proxyModeScoped"
				},
				{
					value: "global",
					label: "proxyModeGlobal"
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: proxyModeStyle,
				role: "radiogroup",
				"aria-label": t("proxyMode"),
				onKeyDown: (event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					const nextIndex = (options.findIndex((option) => option.value === value) + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
					const nextOption = options[nextIndex];
					if (nextOption === void 0) return;
					onChange(nextOption.value);
					event.currentTarget.querySelectorAll("button").item(nextIndex).focus();
				},
				children: options.map((option, index) => {
					const selected = value === option.value;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "radio",
						"aria-checked": selected,
						disabled,
						style: {
							...proxyModeButtonStyle,
							opacity: disabled ? .55 : 1,
							...index === 0 ? {} : { borderLeft: "1px solid var(--dsw-alias-border-l2)" },
							...selected ? {
								background: "var(--dsw-alias-button-primary-fill)",
								color: "var(--dsw-alias-label-primary-foreground)"
							} : {}
						},
						onClick: () => {
							onChange(option.value);
						},
						children: t(option.label)
					}, option.value);
				})
			});
		}
		function progressFillStyle(percent) {
			return {
				width: `${Math.max(0, Math.min(100, percent))}%`,
				height: "100%",
				borderRadius: "inherit",
				background: "var(--dsw-alias-brand-primary, #1677ff)"
			};
		}
		function windowLabel(seconds, t) {
			if (seconds === 18e3) return t("fiveHourLimit");
			if (seconds === 604800) return t("weeklyLimit");
			const hours = seconds / 3600;
			return Number.isInteger(hours) ? t("hourLimit", { count: hours }) : t("usageWindow");
		}
		function formatPercent(percent) {
			return new Intl.NumberFormat(void 0, { maximumFractionDigits: 1 }).format(percent);
		}
		function contextWindowDraft(contextWindow) {
			return contextWindow === null ? "" : String(contextWindow / 1e3);
		}
		function contextWindowTokens(draft) {
			const trimmed = draft.trim();
			if (trimmed.length === 0) return null;
			const match = /^(\d+)(?:\.(\d{1,3}))?$/u.exec(trimmed);
			if (match === null) return void 0;
			const tokens = Number(match[1]) * 1e3 + Number((match[2] ?? "").padEnd(3, "0"));
			return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : void 0;
		}
		function formatContextWindow(tokens) {
			return `${new Intl.NumberFormat(void 0, { maximumFractionDigits: 3 }).format(tokens / 1e3)}K`;
		}
		/** Format a provider-declared Unix-second reset in the user's local timezone. */
		function formatOpenAICodexResetAt(resetAt) {
			if (resetAt === void 0 || !Number.isSafeInteger(resetAt) || resetAt <= 0) return void 0;
			const date = /* @__PURE__ */ new Date(resetAt * 1e3);
			if (!Number.isFinite(date.getTime())) return void 0;
			return new Intl.DateTimeFormat(void 0, {
				dateStyle: "medium",
				timeStyle: "short"
			}).format(date);
		}
		function QuotaBar({ label, percent, detail, t }) {
			const display = formatPercent(percent);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaGroupStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaLabelStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("percentRemaining", { percent: display }) })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: progressTrackStyle,
						role: "progressbar",
						"aria-label": label,
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": percent,
						"aria-valuetext": t("percentRemaining", { percent: display }),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: progressFillStyle(percent) })
					}),
					detail === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: detail
					})
				]
			});
		}
		function UsageLimits({ usage, quotaError, t }) {
			const hasData = usage.rateLimits.length > 0 || usage.credits !== void 0 || usage.individualLimit !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaListStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: quotaTitleStyle,
						children: t("usageLimits")
					}),
					usage.rateLimits.map((limit) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaGroupStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							style: quotaTitleStyle,
							children: limit.name ?? limit.id
						}), limit.windows.map((window) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaBar, {
							label: windowLabel(window.windowSeconds, t),
							percent: window.remainingPercent,
							detail: t("resetAt", { time: formatOpenAICodexResetAt(window.resetAt) ?? t("resetUnavailable") }),
							t
						}, window.windowSeconds))]
					}, limit.id)),
					usage.individualLimit === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaBar, {
						label: t("monthlyLimit"),
						percent: usage.individualLimit.remainingPercent,
						detail: t("exactRemaining", {
							remaining: usage.individualLimit.remaining,
							limit: usage.individualLimit.limit
						}),
						t
					}),
					usage.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaLabelStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("credits") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: usage.credits.unlimited ? t("unlimited") : usage.credits.balance === void 0 ? t("available") : usage.credits.balance })]
					}),
					!hasData && quotaError === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("quotaUnavailable")
					}) : null,
					quotaError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: t("quotaUnavailable")
					})
				]
			});
		}
		function dotStyle(status) {
			return {
				width: 9,
				height: 9,
				borderRadius: "50%",
				flex: "0 0 auto",
				background: status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" || status === "reauth-required" || status === "remote-web-origin-not-trusted" ? "var(--dsw-alias-state-error-primary, #d92d20)" : status === "signing-in" || status === "loading" ? "var(--dsw-alias-brand-primary, #1677ff)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
			};
		}
		var AccountRequestError = class extends Error {
			code;
			constructor(code) {
				super(code);
				this.code = code;
				this.name = "AccountRequestError";
			}
		};
		async function jsonRequest$1(path, method = "GET", body) {
			const response = await fetch(path, {
				method,
				headers: {
					accept: "application/json",
					...body === void 0 ? {} : { "content-type": "application/json" }
				},
				credentials: "same-origin",
				...body === void 0 ? {} : { body: JSON.stringify(body) }
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) throw new AccountRequestError(typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : `HTTP ${response.status}`);
			return value;
		}
		/** OpenAI Codex account status and OAuth actions. */
		function OpenAICodexSettings({ t }) {
			if (t === void 0) throw new Error("OpenAI Codex settings requires its translation function");
			const [status, setStatus] = (0, react.useState)({ status: "loading" });
			const [busy, setBusy] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(false);
			const [copyFailed, setCopyFailed] = (0, react.useState)(false);
			const [imageTools, setImageTools] = (0, react.useState)();
			const [imageToolsBusy, setImageToolsBusy] = (0, react.useState)(false);
			const [imageToolsError, setImageToolsError] = (0, react.useState)();
			const [responseApi, setResponseApi] = (0, react.useState)();
			const [responseApiBusy, setResponseApiBusy] = (0, react.useState)(false);
			const [responseApiError, setResponseApiError] = (0, react.useState)();
			const [modelCatalog, setModelCatalog] = (0, react.useState)();
			const [modelCatalogBusy, setModelCatalogBusy] = (0, react.useState)(false);
			const [modelCatalogError, setModelCatalogError] = (0, react.useState)();
			const [contextWindow, setContextWindow] = (0, react.useState)();
			const [contextWindowDraftValue, setContextWindowDraftValue] = (0, react.useState)("");
			const [contextWindowBusy, setContextWindowBusy] = (0, react.useState)(false);
			const [contextWindowError, setContextWindowError] = (0, react.useState)();
			const [fastMode, setFastMode] = (0, react.useState)();
			const [fastModeBusy, setFastModeBusy] = (0, react.useState)(false);
			const [fastModeError, setFastModeError] = (0, react.useState)();
			const [proxy, setProxy] = (0, react.useState)();
			const [proxyDraft, setProxyDraft] = (0, react.useState)("");
			const [proxyBusy, setProxyBusy] = (0, react.useState)(false);
			const [proxyError, setProxyError] = (0, react.useState)();
			const [proxySaved, setProxySaved] = (0, react.useState)(false);
			const trustedOriginCommand = `dsh plugin --profile web exec dsh-openai-codex trust-origin ${window.location.origin}`;
			const refresh = (0, react.useCallback)(async () => {
				try {
					setStatus(await jsonRequest$1(STATUS_PATH));
				} catch (error) {
					setStatus(error instanceof AccountRequestError && error.code === "remote-web-origin-not-trusted" ? { status: "remote-web-origin-not-trusted" } : {
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					});
				}
			}, [t]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			(0, react.useEffect)(() => {
				jsonRequest$1(IMAGE_TOOLS_PATH).then((value) => {
					setImageTools(value);
					setImageToolsError(void 0);
				}, () => {
					setImageToolsError(t("imageToolSettingsFailed"));
				});
			}, [t]);
			(0, react.useEffect)(() => {
				jsonRequest$1(RESPONSE_API_PATH).then((value) => {
					setResponseApi(value);
					setResponseApiError(void 0);
				}, () => {
					setResponseApiError(t("responseApiSettingsFailed"));
				});
			}, [t]);
			(0, react.useEffect)(() => {
				jsonRequest$1(MODEL_CATALOG_PATH, "POST", { refresh: true }).then((value) => {
					setModelCatalog(value);
					setModelCatalogError(void 0);
				}, () => {
					jsonRequest$1(MODEL_CATALOG_PATH).then((value) => {
						setModelCatalog(value);
						setModelCatalogError(void 0);
					}, () => {
						setModelCatalogError(t("modelCatalogSettingsFailed"));
					});
				});
			}, [t]);
			(0, react.useEffect)(() => {
				jsonRequest$1(CONTEXT_WINDOW_PATH).then((value) => {
					setContextWindow(value);
					setContextWindowDraftValue(contextWindowDraft(value.contextWindow));
					setContextWindowError(void 0);
				}, () => {
					setContextWindowError(t("contextWindowSettingsFailed"));
				});
			}, [t]);
			(0, react.useEffect)(() => {
				jsonRequest$1(FAST_MODE_SETTINGS_PATH).then((value) => {
					setFastMode(value);
					setFastModeError(void 0);
				}, () => {
					setFastModeError(t("fastModeSettingsFailed"));
				});
			}, [t]);
			(0, react.useEffect)(() => {
				jsonRequest$1(PROXY_PATH).then((value) => {
					setProxy(value);
					setProxyDraft(value.proxyUrl);
					setProxyError(void 0);
				}, () => {
					setProxyError(t("proxySettingsFailed"));
				});
			}, [t]);
			(0, react.useEffect)(() => {
				const interval = status.status === "signing-in" ? POLL_INTERVAL_MS : status.status === "signed-in" ? USAGE_POLL_INTERVAL_MS : void 0;
				if (interval === void 0) return;
				const timer = window.setInterval(() => {
					refresh();
				}, interval);
				return () => {
					window.clearInterval(timer);
				};
			}, [refresh, status.status]);
			const signIn = async () => {
				const popup = window.open("about:blank", "_blank");
				if (popup !== null) popup.opener = null;
				setBusy(true);
				setStatus({ status: "signing-in" });
				try {
					const challenge = await jsonRequest$1(LOGIN_PATH, "POST");
					if (popup === null) {
						setStatus({
							status: "error",
							message: t("popupBlocked")
						});
						return;
					}
					popup.location.replace(challenge.url);
				} catch (error) {
					popup?.close();
					setStatus(error instanceof AccountRequestError && error.code === "remote-web-origin-not-trusted" ? { status: "remote-web-origin-not-trusted" } : {
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					});
				} finally {
					setBusy(false);
				}
			};
			const signOut = async () => {
				setBusy(true);
				try {
					await jsonRequest$1(LOGOUT_PATH, "POST");
					setStatus({ status: "signed-out" });
				} catch (error) {
					setStatus({
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					});
				} finally {
					setBusy(false);
				}
			};
			const updateImageTool = async (patch) => {
				setImageToolsBusy(true);
				setImageToolsError(void 0);
				try {
					setImageTools(await jsonRequest$1(IMAGE_TOOLS_PATH, "POST", patch));
				} catch {
					setImageToolsError(t("imageToolSettingsFailed"));
				} finally {
					setImageToolsBusy(false);
				}
			};
			const updateResponseApi = async (patch) => {
				setResponseApiBusy(true);
				setResponseApiError(void 0);
				try {
					setResponseApi(await jsonRequest$1(RESPONSE_API_PATH, "POST", patch));
				} catch {
					setResponseApiError(t("responseApiSettingsFailed"));
				} finally {
					setResponseApiBusy(false);
				}
			};
			const saveModelCatalog = async (models, imageModels) => {
				setModelCatalogBusy(true);
				setModelCatalogError(void 0);
				try {
					setModelCatalog(await jsonRequest$1(MODEL_CATALOG_PATH, "POST", {
						models,
						imageModels
					}));
				} catch {
					setModelCatalogError(t("modelCatalogSettingsFailed"));
				} finally {
					setModelCatalogBusy(false);
				}
			};
			const catalogOptions = (modelCatalog?.availableModels ?? []).map((model) => ({
				id: model.id,
				name: model.name,
				enabled: modelCatalog?.models.includes(model.id) === true,
				supportsImages: modelCatalog?.imageModels?.includes(model.id) ?? model.supportsImages,
				meta: `${model.id} · ${t("modelContextWindowValue", { value: formatContextWindow(model.contextWindow) })}`
			}));
			const catalogIds = () => ({
				models: catalogOptions.filter((option) => option.enabled).map((option) => option.id),
				imageModels: catalogOptions.filter(optionSupportsImages).map((option) => option.id)
			});
			const updateContextWindow = async () => {
				const parsed = contextWindowTokens(contextWindowDraftValue);
				if (parsed === void 0) {
					setContextWindowError(t("contextWindowInvalid"));
					return;
				}
				setContextWindowBusy(true);
				setContextWindowError(void 0);
				try {
					const saved = await jsonRequest$1(CONTEXT_WINDOW_PATH, "POST", { contextWindow: parsed });
					setContextWindow(saved);
					setContextWindowDraftValue(contextWindowDraft(saved.contextWindow));
				} catch {
					setContextWindowError(t("contextWindowSettingsFailed"));
				} finally {
					setContextWindowBusy(false);
				}
			};
			const updateSparkContextWindowOverride = async (checked) => {
				setContextWindowBusy(true);
				setContextWindowError(void 0);
				try {
					setContextWindow(await jsonRequest$1(CONTEXT_WINDOW_PATH, "POST", { overrideSparkContextWindow: checked }));
				} catch {
					setContextWindowError(t("contextWindowSettingsFailed"));
				} finally {
					setContextWindowBusy(false);
				}
			};
			const updateProxy = async (patch) => {
				setProxyBusy(true);
				setProxyError(void 0);
				setProxySaved(false);
				try {
					const saved = await jsonRequest$1(PROXY_PATH, "POST", patch);
					setProxy(saved);
					if (patch.proxyUrl !== void 0) setProxyDraft(saved.proxyUrl);
					setProxySaved(true);
				} catch (error) {
					setProxyError(error instanceof Error ? error.message : t("proxySettingsFailed"));
				} finally {
					setProxyBusy(false);
				}
			};
			const updateFastMode = async (patch) => {
				setFastModeBusy(true);
				setFastModeError(void 0);
				try {
					setFastMode(await jsonRequest$1(FAST_MODE_SETTINGS_PATH, "POST", patch));
				} catch {
					setFastModeError(t("fastModeSettingsFailed"));
				} finally {
					setFastModeBusy(false);
				}
			};
			const copyTrustedOriginCommand = async () => {
				setCopyFailed(false);
				try {
					if (navigator.clipboard?.writeText === void 0) throw new Error("clipboard unavailable");
					await navigator.clipboard.writeText(trustedOriginCommand);
					setCopied(true);
				} catch {
					setCopyFailed(true);
				}
			};
			const label = status.status === "signed-in" ? t("signedIn") : status.status === "loading" ? t("loadingAccount") : status.status === "signing-in" ? t("signingIn") : status.status === "reauth-required" ? t("reauthRequired") : status.status === "remote-web-origin-not-trusted" ? t("remoteOriginTitle") : status.status === "error" ? t("requestFailed") : t("signedOut");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: pageStyle,
				"aria-labelledby": "openai-codex-settings-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "openai-codex-settings-title",
						style: titleStyle,
						children: t("title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							...bodyStyle,
							marginTop: 6
						},
						children: t("intro")
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: rowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: statusStyle,
									role: "status",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										style: dotStyle(status.status)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
								}), status.status === "loading" || status.status === "remote-web-origin-not-trusted" ? null : status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle,
									disabled: busy,
									onClick: () => {
										signOut();
									},
									children: busy ? t("working") : t("logout")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryButtonStyle,
									disabled: busy,
									onClick: () => {
										signIn();
									},
									children: busy ? t("working") : status.status === "error" || status.status === "reauth-required" ? t("loginAgain") : t("login")
								})]
							}),
							status.status === "error" || status.status === "reauth-required" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: status.message
							}) : null,
							status.status === "remote-web-origin-not-trusted" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 10
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: errorStyle,
										children: t("remoteOriginDescription")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: bodyStyle,
										children: t("remoteOriginCommandHelp")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										style: commandStyle,
										children: trustedOriginCommand
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: rowStyle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: buttonStyle,
											onClick: () => {
												copyTrustedOriginCommand();
											},
											children: copied ? t("remoteOriginCopied") : t("remoteOriginCopy")
										}), copyFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: errorStyle,
											children: t("remoteOriginCopyFailed")
										}) : null]
									})
								]
							}) : null,
							status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageLimits, {
								usage: status.usage,
								...status.quotaError === void 0 ? {} : { quotaError: status.quotaError },
								t
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: quotaTitleStyle,
								children: t("proxy")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...bodyStyle,
									marginTop: 5
								},
								children: t("proxyIntro")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProxyModeControl, {
								value: proxy?.proxyMode ?? "off",
								disabled: proxy === void 0 || proxyBusy,
								onChange: (proxyMode) => {
									updateProxy({ proxyMode });
								},
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t(proxy?.proxyMode === "scoped" ? "proxyModeScopedHint" : proxy?.proxyMode === "global" ? "proxyModeGlobalHint" : "proxyModeOffHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									...rowStyle,
									justifyContent: "flex-start"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: "openai-codex-proxy-url",
										style: statusStyle,
										children: t("proxyUrl")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "openai-codex-proxy-url",
										type: "url",
										inputMode: "url",
										spellCheck: false,
										placeholder: t("proxyUrlPlaceholder"),
										value: proxyDraft,
										disabled: proxy === void 0 || proxyBusy,
										style: proxyInputStyle,
										onChange: (event) => {
											setProxyDraft(event.currentTarget.value);
											setProxySaved(false);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: primaryButtonStyle,
										disabled: proxy === void 0 || proxyBusy,
										onClick: () => {
											updateProxy({ proxyUrl: proxyDraft });
										},
										children: proxyBusy ? t("working") : t("proxySave")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("proxyUrlHint")
							}),
							proxyError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: proxyError
							}),
							proxySaved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("proxySaved")
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelCatalogPanel, {
						title: t("modelCatalog"),
						lead: t("modelCatalogIntro"),
						options: catalogOptions,
						busy: modelCatalogBusy,
						error: modelCatalogError,
						empty: modelCatalogBusy ? t("working") : t("modelCatalog"),
						onRefresh: () => {
							setModelCatalogBusy(true);
							setModelCatalogError(void 0);
							jsonRequest$1(MODEL_CATALOG_PATH, "POST", { refresh: true }).then((value) => {
								setModelCatalog(value);
							}, () => {
								setModelCatalogError(t("modelCatalogSettingsFailed"));
							}).finally(() => {
								setModelCatalogBusy(false);
							});
						},
						onToggleEnabled: (modelId, enabled) => {
							const current = new Set(catalogIds().models);
							if (enabled) current.add(modelId);
							else current.delete(modelId);
							saveModelCatalog([...current], catalogIds().imageModels);
						},
						onToggleImage: (modelId, supportsImages) => {
							const current = new Set(catalogIds().imageModels);
							if (supportsImages) current.add(modelId);
							else current.delete(modelId);
							saveModelCatalog(catalogIds().models, [...current]);
						},
						onSetAllEnabled: (enabled) => {
							saveModelCatalog(enabled ? catalogOptions.map((option) => option.id) : [], catalogIds().imageModels);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: quotaTitleStyle,
								children: t("contextWindow")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...bodyStyle,
									marginTop: 5
								},
								children: t("contextWindowIntro")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									...rowStyle,
									justifyContent: "flex-start"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: "openai-codex-context-window",
										style: statusStyle,
										children: t("contextWindowInput")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "openai-codex-context-window",
										type: "number",
										inputMode: "decimal",
										min: "0.001",
										step: "0.001",
										placeholder: t("contextWindowPlaceholder"),
										value: contextWindowDraftValue,
										disabled: contextWindow === void 0 || contextWindowBusy,
										style: numberInputStyle,
										onChange: (event) => {
											setContextWindowDraftValue(event.currentTarget.value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: primaryButtonStyle,
										disabled: contextWindow === void 0 || contextWindowBusy,
										onClick: () => {
											updateContextWindow();
										},
										children: contextWindowBusy ? t("working") : t("contextWindowSave")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: toggleRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: toggleCopyStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: statusStyle,
										children: t("overrideSparkContextWindow")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: bodyStyle,
										children: t("overrideSparkContextWindowHint")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreferenceToggle, {
									label: t("overrideSparkContextWindow"),
									disabled: contextWindow === void 0 || contextWindowBusy,
									checked: contextWindow?.overrideSparkContextWindow ?? false,
									onChange: (checked) => {
										updateSparkContextWindowOverride(checked);
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("contextWindowHint")
							}),
							contextWindowError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: contextWindowError
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: quotaTitleStyle,
								children: t("imageTools")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...bodyStyle,
									marginTop: 5
								},
								children: t("imageToolsIntro")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: toggleRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: toggleCopyStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: statusStyle,
										children: t("modifyReadImage")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: bodyStyle,
										children: t("modifyReadImageHint")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreferenceToggle, {
									label: t("modifyReadImage"),
									disabled: imageTools === void 0 || imageToolsBusy,
									checked: imageTools?.modifyReadImage ?? false,
									onChange: (checked) => {
										updateImageTool({ modifyReadImage: checked });
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: toggleRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: toggleCopyStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: statusStyle,
										children: t("shareImagegen")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: bodyStyle,
										children: t("shareImagegenHint")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreferenceToggle, {
									label: t("shareImagegen"),
									disabled: imageTools === void 0 || imageToolsBusy,
									checked: imageTools?.shareImagegenWithOtherModels ?? false,
									onChange: (checked) => {
										updateImageTool({ shareImagegenWithOtherModels: checked });
									}
								})]
							}),
							imageToolsError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: imageToolsError
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: quotaTitleStyle,
								children: t("responseApi")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...bodyStyle,
									marginTop: 5
								},
								children: t("responseApiIntro")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: toggleRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: toggleCopyStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: statusStyle,
										children: t("webSocketContextReuse")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: bodyStyle,
										children: t("webSocketContextReuseHint")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreferenceToggle, {
									label: t("webSocketContextReuse"),
									disabled: responseApi === void 0 || responseApiBusy,
									checked: responseApi?.useWebSocketContextReuse ?? false,
									onChange: (checked) => {
										updateResponseApi({ useWebSocketContextReuse: checked });
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: toggleRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: toggleCopyStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: statusStyle,
										children: t("nativeCompaction")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: bodyStyle,
										children: t("nativeCompactionHint")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreferenceToggle, {
									label: t("nativeCompaction"),
									disabled: responseApi === void 0 || responseApiBusy,
									checked: responseApi?.useNativeCompaction ?? false,
									onChange: (checked) => {
										updateResponseApi({ useNativeCompaction: checked });
									}
								})]
							}),
							responseApiError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: responseApiError
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: quotaTitleStyle,
								children: t("fastMode")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...bodyStyle,
									marginTop: 5
								},
								children: t("fastModeIntro")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: toggleRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: toggleCopyStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: statusStyle,
										children: t("fastModeDefault")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: bodyStyle,
										children: t("fastModeDefaultHint")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreferenceToggle, {
									label: t("fastModeDefault"),
									disabled: fastMode === void 0 || fastModeBusy,
									checked: fastMode?.fastModeDefault ?? false,
									onChange: (checked) => {
										updateFastMode({ fastModeDefault: checked });
									}
								})]
							}),
							fastModeError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: fastModeError
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/codex/locales.ts
		/** Chinese copy for the OpenAI Codex settings page. */
		const zh = {
			nav: "OpenAI Codex",
			title: "OpenAI Codex",
			intro: "使用 ChatGPT 订阅在 dsh 中调用模型，无需 API Key。",
			loadingAccount: "正在加载账户信息…",
			signedOut: "尚未登录",
			signingIn: "正在等待浏览器授权…",
			signedIn: "已登录",
			reauthRequired: "需要重新登录",
			login: "使用 ChatGPT 登录",
			loginAgain: "重新登录",
			logout: "退出登录",
			working: "处理中…",
			retry: "重试",
			popupBlocked: "浏览器阻止了登录窗口。请允许此 dsh 页面弹出窗口后重试。",
			usageLimits: "使用额度",
			fiveHourLimit: "5 小时额度",
			weeklyLimit: "每周额度",
			hourLimit: "{count} 小时额度",
			usageWindow: "使用额度",
			percentRemaining: "剩余 {percent}%",
			monthlyLimit: "每月信用额度",
			exactRemaining: "剩余 {remaining} / {limit} credits",
			credits: "Credits",
			unlimited: "无限",
			available: "可用",
			quotaUnavailable: "暂时无法获取使用额度。",
			resetAt: "重置时间：{time}",
			resetUnavailable: "无法获取重置时间",
			composerWeeklyQuota: "Codex 周额度",
			composerWeeklyQuotaSummary: "Codex 周额度：剩余 {percent}%；重置时间 {time}",
			fastModeLoadingTitle: "正在加载此对话的 Fast Mode 状态。",
			fastModeUnavailableTitle: "此对话暂时无法使用 Fast Mode。",
			fastModeEnabledTitle: "当前：1.5 倍速度，额度消耗更快。点击切换到标准速度",
			fastModeDisabledTitle: "当前：标准速度。点击开启 1.5 倍速度",
			fastMode: "Fast Mode",
			fastModeIntro: "通过提供方的 priority service tier 加速 Codex 请求。",
			fastModeDefault: "默认强制开启 1.5 倍速",
			fastModeDefaultHint: "开启后所有会话默认使用 1.5 倍速，额度消耗更快，无需逐会话点击 ⚡ 开关。",
			fastModeSettingsFailed: "无法保存 Fast Mode 设置。",
			requestFailed: "OpenAI Codex 账户请求失败。",
			remoteOriginTitle: "浏览器来源尚未受信任",
			remoteOriginDescription: "OpenAI Codex 仅接受本机页面，或已在运行 dsh 的设备上明确授权的浏览器来源发起 OAuth 请求。",
			remoteOriginCommandHelp: "请在 dsh 主机上运行以下命令，然后重试：",
			remoteOriginCopy: "复制命令",
			remoteOriginCopied: "已复制",
			remoteOriginCopyFailed: "无法复制命令。",
			proxy: "网络代理",
			proxyIntro: "选择插件应用代理的范围；修改后无需重启 dsh。",
			proxyMode: "代理范围",
			proxyModeOff: "跟随 dsh",
			proxyModeScoped: "仅 Codex",
			proxyModeGlobal: "整个 dsh",
			proxyModeOffHint: "插件不覆盖网络设置；如果 dsh 启动时已配置进程级代理，Codex 仍会遵循该策略。",
			proxyModeScopedHint: "仅认证完成后的 Codex HTTP 请求使用此代理；OAuth Token 刷新和 WebSocket 仍遵循 dsh 的网络策略。",
			proxyModeGlobalHint: "把此代理应用到整个 dsh 进程，并覆盖 OAuth；其他插件的请求也会受到影响。",
			proxyUrl: "代理 URL",
			proxyUrlPlaceholder: "使用代理环境变量",
			proxyUrlHint: "请输入 HTTP(S) 代理 URL；留空时读取 DSH_CODEX_PROXY，或标准的 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 与 NO_PROXY 环境变量。",
			proxySave: "保存代理",
			proxySaved: "代理设置已保存。",
			proxySettingsFailed: "无法保存代理设置。",
			modelCatalog: "模型选择器中显示的模型",
			modelCatalogIntro: "刷新会从 Codex 账号活体目录拉取（含 gpt-6-luna / gpt-6-sol）。勾选「支持图像」后 DSH 不会把图片拦截成文本。",
			modelCatalogSettingsFailed: "无法保存模型选择器设置。",
			modelFieldName: "名称：",
			modelFieldId: "ID：",
			modelFieldDefaultWindow: "默认窗口：",
			modelFieldEnabled: "启用：",
			modelEnableLabel: "在模型选择器中显示 {name}",
			modelContextWindowValue: "{value} tokens",
			contextWindow: "上下文窗口",
			contextWindowIntro: "覆盖 dsh 在下一次模型请求中用于上下文用量显示、溢出判断和自动压缩的客户端容量。",
			contextWindowInput: "容量（K tokens）",
			contextWindowPlaceholder: "提供方默认值",
			contextWindowHint: "各模型的提供方默认值显示在上方模型列表中；留空会使用这些默认值。覆盖值默认应用于 Spark 之外的 Codex 模型，已打开会话的用量显示会在下一次请求后刷新。该设置不会提高后端的真实容量，超过模型能力时请求仍可能溢出。",
			overrideSparkContextWindow: "同时覆盖 GPT-5.3 Codex Spark",
			overrideSparkContextWindowHint: "默认关闭，使 Spark 保持提供方声明的 128K 窗口；仅在确认 Spark 支持所设覆盖值时启用。",
			contextWindowSave: "保存容量",
			contextWindowInvalid: "请输入以 K tokens 为单位的正数，或留空恢复默认值。",
			contextWindowSettingsFailed: "无法保存上下文窗口设置。",
			imageTools: "图片工具",
			imageToolsIntro: "扩展 Harness 的图片读取能力，并选择其他视觉模型能否使用生图。",
			modifyReadImage: "增强 read_image",
			modifyReadImageHint: "为 Harness 自带的 read_image 增加 HTTP(S) URL 输入；本地路径继续使用原有文件系统实现。",
			shareImagegen: "允许其他模型使用生图",
			shareImagegenHint: "允许非 Codex 视觉模型通过你的 ChatGPT Codex 登录生成或编辑图片。",
			imageToolSettingsFailed: "无法保存图片工具设置。",
			responseApi: "Responses API 实验功能",
			responseApiIntro: "这些开关只影响 OpenAI Codex 请求。关闭开关后，已有会话仍可继续使用。",
			webSocketContextReuse: "WebSocket 上下文复用",
			webSocketContextReuseHint: "保持 store 关闭；同一 Codex WebSocket 连接内上下文严格衔接时，通过 previous_response_id 发送增量。",
			nativeCompaction: "原生 Responses 压缩",
			nativeCompactionHint: "通过 /responses 发送 compaction_trigger，调用 Codex V2 压缩，并把返回的加密 compaction item 带入后续请求；V2 不可用时自动回退到 Harness 压缩。",
			responseApiSettingsFailed: "无法保存 Responses API 设置。",
			toolCallTitle: "工具调用",
			imageGenerating: "正在生成…",
			imageGenerationFailed: "生成失败",
			imageGeneratedAttachmentOnly: "图片已生成，但保存到工作区失败",
			generatedImage: "生成的图片",
			imageOpen: "查看原图",
			imageOpenNamed: "查看原图：{name}",
			imageLoading: "正在加载图片…",
			imageLoadFailed: "图片加载失败，点击重试。",
			imagePreview: "图片预览",
			imageClose: "关闭图片预览",
			inspectToolCall: "检查",
			imageSavedAs: "已保存到"
		};
		//#endregion
		//#region src/client/codex/CodexSettingsPanel.tsx
		/** Default translation function using zh dictionary with placeholder replacement. */
		function defaultTranslate(key, params) {
			let template = zh[key] ?? key;
			if (params !== void 0) for (const [k, v] of Object.entries(params)) template = template.replaceAll(`{${k}}`, String(v));
			return template;
		}
		/** Standalone panel for Codex preferences. */
		function CodexSettingsPanel() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { marginTop: 16 },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpenAICodexSettings, { t: defaultTranslate })
			});
		}
		//#endregion
		//#region src/client/antigravity/AntigravitySettingsPanel.tsx
		/**
		* Antigravity model catalog inside the unified reverse-proxy settings tab.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/antigravity/AntigravitySettingsPanel
		*/
		const MODELS_PATH$2 = "/antigravity/api/models";
		const QUOTA_PATH = "/antigravity/api/quota";
		var CatalogRequestError$1 = class extends Error {
			constructor(message) {
				super(message);
				this.name = "CatalogRequestError";
			}
		};
		async function jsonRequest(path, method = "GET", body) {
			const response = await fetch(path, {
				method,
				headers: {
					accept: "application/json",
					...body === void 0 ? {} : { "content-type": "application/json" }
				},
				credentials: "same-origin",
				...body === void 0 ? {} : { body: JSON.stringify(body) }
			});
			const value = await response.json().catch(() => void 0);
			const envelope = value !== null && typeof value === "object" ? value : void 0;
			if (!response.ok || envelope?.["ok"] === false) {
				const error = envelope?.["error"];
				throw new CatalogRequestError$1(typeof error === "string" ? error : `HTTP ${String(response.status)}`);
			}
			return envelope?.["value"] ?? value;
		}
		/** Live Antigravity model catalog with enable and image-support toggles. */
		function AntigravitySettingsPanel() {
			const [catalog, setCatalog] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const load = (0, react.useCallback)(async (refreshLive) => {
				setBusy(true);
				setError(void 0);
				try {
					if (refreshLive) try {
						const quota = await jsonRequest(QUOTA_PATH, "POST");
						if (quota.models !== void 0) {
							setCatalog(quota.models);
							return;
						}
					} catch {}
					setCatalog(await jsonRequest(MODELS_PATH$2));
				} catch (caught) {
					setError(caught instanceof Error ? caught.message : String(caught));
				} finally {
					setBusy(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				load(true);
			}, [load]);
			const save = (0, react.useCallback)(async (enabledModelIds, imageModelIds) => {
				setBusy(true);
				setError(void 0);
				try {
					setCatalog(await jsonRequest(MODELS_PATH$2, "POST", {
						enabledModelIds,
						imageModelIds
					}));
				} catch (caught) {
					setError(caught instanceof Error ? caught.message : String(caught));
				} finally {
					setBusy(false);
				}
			}, []);
			const currentIds = (0, react.useCallback)(() => {
				const options = catalog?.options ?? [];
				return {
					enabledModelIds: options.filter((option) => option.enabled).map((option) => option.id),
					imageModelIds: options.filter(optionSupportsImages).map((option) => option.id)
				};
			}, [catalog]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelCatalogPanel, {
				options: catalog?.options ?? [],
				busy,
				error,
				note: "勾选即自动保存。同池模型共享 5 小时与每周额度窗口。重新打开模型选择器即可看到最新列表；运行中的旧会话不受影响。",
				onRefresh: () => {
					load(true);
				},
				onToggleEnabled: (modelId, enabled) => {
					const current = new Set(currentIds().enabledModelIds);
					if (enabled) current.add(modelId);
					else current.delete(modelId);
					save([...current], currentIds().imageModelIds);
				},
				onToggleImage: (modelId, supportsImages) => {
					const current = new Set(currentIds().imageModelIds);
					if (supportsImages) current.add(modelId);
					else current.delete(modelId);
					save(currentIds().enabledModelIds, [...current]);
				},
				onSetAllEnabled: (enabled) => {
					const options = catalog?.options ?? [];
					save(enabled ? options.map((option) => option.id) : [], currentIds().imageModelIds);
				}
			});
		}
		//#endregion
		//#region src/client/models/catalog-request.ts
		/**
		* Shared JSON helper for plugin-owned catalog endpoints.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/models/catalog-request
		*/
		var CatalogRequestError = class extends Error {
			constructor(message) {
				super(message);
				this.name = "CatalogRequestError";
			}
		};
		/** GET/POST a `{ ok, value }` catalog envelope. */
		async function catalogRequest(path, method = "GET", body) {
			const response = await fetch(path, {
				method,
				headers: {
					accept: "application/json",
					...body === void 0 ? {} : { "content-type": "application/json" }
				},
				credentials: "same-origin",
				...body === void 0 ? {} : { body: JSON.stringify(body) }
			});
			const value = await response.json().catch(() => void 0);
			const envelope = value !== null && typeof value === "object" ? value : void 0;
			if (!response.ok || envelope?.["ok"] === false) {
				const error = envelope?.["error"];
				throw new CatalogRequestError(typeof error === "string" ? error : `HTTP ${String(response.status)}`);
			}
			return envelope?.["value"] ?? value;
		}
		//#endregion
		//#region src/client/workbuddy/WorkBuddySettingsPanel.tsx
		/**
		* WorkBuddy live model catalog inside the unified reverse-proxy settings tab.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/workbuddy/WorkBuddySettingsPanel
		*/
		const MODELS_PATH$1 = "/plugins/dsh-proxy-monitor/workbuddy/models";
		/** Live WorkBuddy model catalog with enable and image-support toggles. */
		function WorkBuddySettingsPanel() {
			const [catalog, setCatalog] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const load = (0, react.useCallback)(async (refreshLive) => {
				setBusy(true);
				setError(void 0);
				try {
					setCatalog(refreshLive ? await catalogRequest(MODELS_PATH$1, "POST", { refresh: true }) : await catalogRequest(MODELS_PATH$1));
				} catch (caught) {
					try {
						setCatalog(await catalogRequest(MODELS_PATH$1));
					} catch {
						setError(caught instanceof Error ? caught.message : String(caught));
					}
				} finally {
					setBusy(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				load(true);
			}, [load]);
			const save = (0, react.useCallback)(async (enabledModelIds, imageModelIds) => {
				setBusy(true);
				setError(void 0);
				try {
					setCatalog(await catalogRequest(MODELS_PATH$1, "POST", {
						enabledModelIds,
						imageModelIds
					}));
				} catch (caught) {
					setError(caught instanceof Error ? caught.message : String(caught));
				} finally {
					setBusy(false);
				}
			}, []);
			const currentIds = (0, react.useCallback)(() => {
				const options = catalog?.options ?? [];
				return {
					enabledModelIds: options.filter((option) => option.enabled).map((option) => option.id),
					imageModelIds: options.filter(optionSupportsImages).map((option) => option.id)
				};
			}, [catalog]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelCatalogPanel, {
				options: catalog?.options ?? [],
				busy,
				error,
				note: "勾选即自动保存。列表来自 WorkBuddy 国服桌面端目录。重新打开模型选择器即可看到最新列表。",
				onRefresh: () => {
					load(true);
				},
				onToggleEnabled: (modelId, enabled) => {
					const current = new Set(currentIds().enabledModelIds);
					if (enabled) current.add(modelId);
					else current.delete(modelId);
					save([...current], currentIds().imageModelIds);
				},
				onToggleImage: (modelId, supportsImages) => {
					const current = new Set(currentIds().imageModelIds);
					if (supportsImages) current.add(modelId);
					else current.delete(modelId);
					save(currentIds().enabledModelIds, [...current]);
				},
				onSetAllEnabled: (enabled) => {
					const options = catalog?.options ?? [];
					save(enabled ? options.map((option) => option.id) : [], currentIds().imageModelIds);
				}
			});
		}
		//#endregion
		//#region src/client/grok/GrokSettingsPanel.tsx
		/**
		* Grok live model catalog inside the unified reverse-proxy settings tab.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/grok/GrokSettingsPanel
		*/
		const MODELS_PATH = "/plugins/dsh-proxy-monitor/grok/models";
		/** Live Grok model catalog with enable and image-support toggles. */
		function GrokSettingsPanel() {
			const [catalog, setCatalog] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const load = (0, react.useCallback)(async (refreshLive) => {
				setBusy(true);
				setError(void 0);
				try {
					setCatalog(refreshLive ? await catalogRequest(MODELS_PATH, "POST", { refresh: true }) : await catalogRequest(MODELS_PATH));
				} catch (caught) {
					try {
						setCatalog(await catalogRequest(MODELS_PATH));
					} catch {
						setError(caught instanceof Error ? caught.message : String(caught));
					}
				} finally {
					setBusy(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				load(true);
			}, [load]);
			const save = (0, react.useCallback)(async (enabledModelIds, imageModelIds) => {
				setBusy(true);
				setError(void 0);
				try {
					setCatalog(await catalogRequest(MODELS_PATH, "POST", {
						enabledModelIds,
						imageModelIds
					}));
				} catch (caught) {
					setError(caught instanceof Error ? caught.message : String(caught));
				} finally {
					setBusy(false);
				}
			}, []);
			const currentIds = (0, react.useCallback)(() => {
				const options = catalog?.options ?? [];
				return {
					enabledModelIds: options.filter((option) => option.enabled).map((option) => option.id),
					imageModelIds: options.filter(optionSupportsImages).map((option) => option.id)
				};
			}, [catalog]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelCatalogPanel, {
				options: catalog?.options ?? [],
				busy,
				error,
				note: "勾选即自动保存。列表来自 xAI 活体 /v1/models，而不是写死的 pi-ai 快照。重新打开模型选择器即可看到最新列表。",
				onRefresh: () => {
					load(true);
				},
				onToggleEnabled: (modelId, enabled) => {
					const current = new Set(currentIds().enabledModelIds);
					if (enabled) current.add(modelId);
					else current.delete(modelId);
					save([...current], currentIds().imageModelIds);
				},
				onToggleImage: (modelId, supportsImages) => {
					const current = new Set(currentIds().imageModelIds);
					if (supportsImages) current.add(modelId);
					else current.delete(modelId);
					save(currentIds().enabledModelIds, [...current]);
				},
				onSetAllEnabled: (enabled) => {
					const options = catalog?.options ?? [];
					save(enabled ? options.map((option) => option.id) : [], currentIds().imageModelIds);
				}
			});
		}
		//#endregion
		//#region src/client/accounts/tabs.tsx
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
		function buildProviderTabs(_accounts) {
			return [
				{
					id: "codex",
					label: "Codex",
					render: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CodexSettingsPanel, {})
				},
				{
					id: "antigravity",
					label: "Antigravity",
					render: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AntigravitySettingsPanel, {})
				},
				{
					id: "workbuddy",
					label: "WorkBuddy",
					render: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkBuddySettingsPanel, {})
				},
				{
					id: "grok",
					label: "Grok",
					render: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GrokSettingsPanel, {})
				}
			];
		}
		//#endregion
		//#region src/geometry.ts
		/** A finite, non-negative, rounded width from a possibly-unusable measurement. */
		function width(value) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
			return Math.round(value);
		}
		/**
		* Turn one measurement into the insets the rail positions against.
		*
		* ## Why the panel width wins over the animating track
		*
		* ui-sidebar-right positions its panel `absolute; right: 0` inside the grid
		* column and gives it an explicit width, while the column's own track animates
		* `0 -> width` during the open transition (`rightbarCol` is `overflow: visible`
		* precisely so the panel can hang over a zero-width track). The panel's rect
		* width is therefore constant for the whole transition, whereas the track
		* starts at 0.
		*
		* Preferring the track would make the offset oscillate: at the instant of
		* opening the track reads 0 (falling back to the wide panel), then reads a small
		* positive value on the next frame, so the rail would jitter outward and back.
		* Preferring the panel width instead makes the offset snap once to its final
		* value as the panel opens, and the panel then slides in to meet the rail — one
		* smooth motion, no oscillation.
		*
		* The track is kept only as a fallback, for a composition that opens a track
		* without a measurable panel.
		*
		* @param input - one geometry sample.
		* @returns the insets, clamped to the frame so the rail can never leave the viewport.
		*/
		function computeInsets(input) {
			const frameWidth = width(input.frameWidth);
			if (input.rightbarFullscreen) return {
				sidebar: 0,
				rightbar: 0,
				rightbarFullscreen: true
			};
			const sidebar = Math.min(width(input.sidebarWidth), frameWidth);
			if (!input.panelOpen) return {
				sidebar,
				rightbar: 0,
				rightbarFullscreen: false
			};
			const panel = width(input.panelWidth);
			const track = width(input.columnWidth);
			return {
				sidebar,
				rightbar: Math.min(panel > 0 ? panel : track, frameWidth),
				rightbarFullscreen: false
			};
		}
		/**
		* How far left the turn navigator must move to sit clear of the rail.
		*
		* Returns 0 whenever there is nothing to clear — the rail is hidden, the
		* navigator is not rendered (it is `display: none` on a narrow viewport, which
		* measures as a zero-width rect), or the two do not overlap. A hidden navigator
		* must never be "shifted", and a zero result is also what returns it to its
		* natural place once the rail goes away.
		*
		* @param input - one measurement.
		* @returns the shift in px, never negative.
		*/
		function computeTurnNavShift(input) {
			if (!input.railVisible) return 0;
			if (!input.railOnRight) return 0;
			if (!Number.isFinite(input.navWidth) || input.navWidth <= 0) return 0;
			if (!Number.isFinite(input.navRight) || !Number.isFinite(input.railLeft)) return 0;
			const naturalRight = input.navRight + input.appliedShift;
			const gap = Number.isFinite(input.gap) && input.gap > 0 ? input.gap : 0;
			const overlap = Math.round(naturalRight + gap - input.railLeft);
			return overlap > 0 ? overlap : 0;
		}
		/**
		* Whether two readings agree, so a redundant observation does not re-render.
		* @param left - one reading.
		* @param right - the other reading.
		* @returns true when every field matches.
		*/
		function sameInsets(left, right) {
			return left.sidebar === right.sidebar && left.rightbar === right.rightbar && left.rightbarFullscreen === right.rightbarFullscreen;
		}
		/** The insets used before the first measurement resolves. */
		const NO_INSETS = {
			sidebar: 0,
			rightbar: 0,
			rightbarFullscreen: false
		};
		//#endregion
		//#region src/client/frame.ts
		/**
		* Live frame geometry for the floating rail (browser half).
		*
		* The rail renders into `shell.overlay`, a layer covering the whole frame —
		* including the columns the two sidebars occupy. A rail pinned to the viewport
		* edge would sit on top of the right sidebar whenever that panel is open, so the
		* rail is offset by the panels' measured widths instead.
		*
		* ## Why a ResizeObserver, and why "open" drives the offset
		*
		* `AppFrame` carries `transition: grid-template-columns` (ui-layout's own
		* stylesheet). The frame's resolved grid is therefore interpolated frame by
		* frame while a panel opens or closes, while its inline style changes exactly
		* once — at the start. Reading computed geometry in response to *that* style
		* mutation sees a mid-transition value, and because the transition's end emits
		* no further DOM mutation, the stale value would stick: the offset stayed at the
		* panel's old width and the rail was left stranded mid-frame with no way back.
		*
		* Two things fix that, and both are needed:
		*
		* 1. **A ResizeObserver on the real boxes.** It fires on every frame of the
		*    transition and once more when the geometry settles, so the final read is
		*    the settled one. A `transitionend` listener covers a skipped transition.
		* 2. **`panelOpen` gates the offset** (see `geometry.ts`). The offset exists
		*    only while a panel reports itself open, so a stale or unreadable width can
		*    never park the rail away from the screen edge.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/frame
		*/
		/** The overlay layer carries this attribute; the frame is its parent. */
		const OVERLAY_ATTRIBUTE$1 = "data-shell-overlay";
		/** The right panel's grid column, present in every composition. */
		const RIGHT_COLUMN_ATTRIBUTE = "data-rightbar-col";
		/** Present on the right panel exactly while it is expanded. */
		const PANEL_OPEN_ATTRIBUTE = "data-sidebar-right-open";
		/**
		* The layout frame that owns the overlay layer this rail is mounted in.
		* @param host - the rail's outermost element.
		* @returns the frame element, or undefined when the composition is not mounted.
		*/
		function frameOf(host) {
			return (host.closest(`[${OVERLAY_ATTRIBUTE$1}]`) ?? host.parentElement)?.parentElement ?? void 0;
		}
		/**
		* The left sidebar column.
		*
		* `AppFrame` renders `DocumentTitle` first, but that component returns null, so
		* the frame's first *element* child is the sidebar column. The overlay check
		* guards that assumption: if a future composition reorders the children this
		* returns undefined and the rail simply keeps its zero left inset rather than
		* measuring the wrong box.
		* @param frame - the layout frame.
		* @returns the sidebar column, or undefined.
		*/
		function sidebarColumnOf(frame) {
			const first = frame.children[0];
			if (!(first instanceof HTMLElement) || first.hasAttribute(OVERLAY_ATTRIBUTE$1)) return void 0;
			return first;
		}
		/** Measure a box's border-box width, or undefined when the element is absent. */
		function widthOf(element) {
			if (!(element instanceof HTMLElement)) return void 0;
			const width = element.getBoundingClientRect().width;
			return Number.isFinite(width) ? width : void 0;
		}
		/**
		* Sample the frame's current geometry.
		* @param frame - the layout frame.
		* @returns the insets for this instant.
		*/
		function measure(frame) {
			const panel = frame.querySelector(`[${PANEL_OPEN_ATTRIBUTE}]`);
			const column = frame.querySelector(`[${RIGHT_COLUMN_ATTRIBUTE}]`);
			return computeInsets({
				frameWidth: frame.getBoundingClientRect().width,
				sidebarWidth: widthOf(sidebarColumnOf(frame)),
				panelOpen: panel !== null,
				panelWidth: widthOf(panel),
				columnWidth: widthOf(column),
				rightbarFullscreen: frame.hasAttribute("data-rightbar-fullscreen")
			});
		}
		/**
		* Track the frame's column geometry while `active`.
		* @param host - the rail's outermost element, used to locate the frame.
		* @param active - whether the rail is mounted at all.
		* @returns the current insets.
		*/
		function useFrameInsets(host, active) {
			const [insets, setInsets] = (0, react.useState)(NO_INSETS);
			(0, react.useEffect)(() => {
				if (!active || host === null) return;
				const frame = frameOf(host);
				if (frame === void 0) return;
				let current = NO_INSETS;
				const read = () => {
					const next = measure(frame);
					if (sameInsets(current, next)) return;
					current = next;
					setInsets(next);
				};
				read();
				const sizes = new ResizeObserver(read);
				const observeBoxes = () => {
					sizes.disconnect();
					sizes.observe(frame);
					const sidebar = sidebarColumnOf(frame);
					if (sidebar !== void 0) sizes.observe(sidebar);
					const column = frame.querySelector(`[${RIGHT_COLUMN_ATTRIBUTE}]`);
					if (column instanceof HTMLElement) sizes.observe(column);
					const panel = frame.querySelector(`[${PANEL_OPEN_ATTRIBUTE}]`);
					if (panel instanceof HTMLElement) sizes.observe(panel);
				};
				observeBoxes();
				const structure = new MutationObserver(() => {
					observeBoxes();
					read();
				});
				structure.observe(frame, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: [
						PANEL_OPEN_ATTRIBUTE,
						"data-sidebar-right-panel",
						"data-rightbar-fullscreen",
						"data-rightbar-collapsed"
					]
				});
				frame.addEventListener("transitionend", read);
				return () => {
					sizes.disconnect();
					structure.disconnect();
					frame.removeEventListener("transitionend", read);
				};
			}, [host, active]);
			return insets;
		}
		//#endregion
		//#region src/client/icons.tsx
		/** DeepSeek: the whale tail over a wave. */
		function DeepSeekMark({ size = 20 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "currentColor",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 2.6c-3.5 0-6.3 2.5-6.3 5.9 0 1.5.5 2.8 1.4 3.8-.5.2-1.3.6-1.9 1.3-.8.9-1.1 2-1.1 3.1 0 .5.4.9.9.9.4 0 .7-.2.8-.6.2-.8.6-1.5 1.2-2 .5-.4 1-.6 1.4-.7.9.6 2 1 3.6 1 1.6 0 2.7-.4 3.6-1 .4.1.9.3 1.4.7.6.5 1 1.2 1.2 2 .1.4.4.6.8.6.5 0 .9-.4.9-.9 0-1.1-.3-2.2-1.1-3.1-.6-.7-1.4-1.1-1.9-1.3.9-1 1.4-2.3 1.4-3.8 0-3.4-2.8-5.9-6.3-5.9Zm0 2c2.4 0 4.3 1.7 4.3 3.9S14.4 12.4 12 12.4 7.7 10.7 7.7 8.5 9.6 4.6 12 4.6Z" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "9.9",
						cy: "8.2",
						r: "1.15"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "14.1",
						cy: "8.2",
						r: "1.15"
					})
				]
			});
		}
		/** OpenAI / Codex: the interlocking knot, simplified to its outer lobes. */
		function CodexMark({ size = 20 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.7",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 3.2 19 7.2v8l-7 4-7-4v-8l7-4Z",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 3.2v8m0 0 7-4m-7 4-7-4m7 4v8",
					strokeLinecap: "round"
				})]
			});
		}
		/** Google / Gemini: the four-point star. */
		function GeminiMark({ size = 20 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "currentColor",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 2.2c.7 4.6 2.4 6.9 7.6 7.6-5 .7-6.9 3-7.6 7.6-.7-4.6-2.4-6.9-7.6-7.6 5-.7 6.9-3 7.6-7.6Zm5.6 11.4c.3 2 1 3 3.2 3.3-2.1.3-2.9 1.3-3.2 3.3-.3-2-1-3-3.2-3.3 2.2-.3 2.9-1.3 3.2-3.3Z" })
			});
		}
		/** xAI / Grok: the slashed square. */
		function GrokMark({ size = 20 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.7",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3.4",
					y: "3.4",
					width: "17.2",
					height: "17.2",
					rx: "3.4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m8.2 15.8 7.6-7.6M8.6 8.6l6.8 6.8",
					strokeLinecap: "round"
				})]
			});
		}
		/** Anthropic / Claude: the radiating burst. */
		function ClaudeMark({ size = 20 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.6",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("g", {
					strokeLinecap: "round",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" })
				})
			});
		}
		/** WorkBuddy: a rounded terminal prompt, matching the desktop app's mark. */
		function WorkBuddyMark({ size = 20 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.7",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3.2",
					y: "4.4",
					width: "17.6",
					height: "15.2",
					rx: "3.4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m7.6 9.6 2.6 2.4-2.6 2.4M12.4 14.8h4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		/** The mark for a provider id; a neutral dot for an unknown one. */
		function providerMark(id, size = 20) {
			switch (id) {
				case "deepseek": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeepSeekMark, { size });
				case "codex": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CodexMark, { size });
				case "antigravity": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GeminiMark, { size });
				case "grok": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GrokMark, { size });
				case "claude": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ClaudeMark, { size });
				case "workbuddy": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkBuddyMark, { size });
				default: return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "currentColor",
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "4"
					})
				});
			}
		}
		//#endregion
		//#region src/client/turnnav.ts
		/**
		* Keeping DSH's own turn navigator clear of the rail (browser half).
		*
		* The conversation view owns a vertical turn-navigation rail — one tick per
		* turn, pinned near the right edge of the chat column with its marks
		* **right-aligned**. The quota rail is flush against the frame edge, so the two
		* want the same pixels and the navigator ends up underneath the slab.
		*
		* ## Why this plugin moves the navigator, not the other way round
		*
		* Pushing the quota rail inward would defeat its whole point: it is designed to
		* grow out of the screen edge, and a gap of one rail-width is exactly the
		* "floating card in the middle of the screen" look the design rejects. The
		* navigator, by contrast, is a navigation affordance with slack to its left, so
		* nudging it left by the overlap is invisible apart from the benefit.
		*
		* ## Why the element is found structurally
		*
		* The navigator's class name is CSS-Modules-hashed (`eGxaPq_frame`) and changes
		* whenever that package is rebuilt, so selecting on it would break silently on
		* a harness upgrade. Its *aria-label* is localised. What is stable is its
		* structure: a `nav` that is absolutely positioned inside a zero-height sticky
		* slot. That is what {@link findTurnNavigator} matches, and it matches nothing
		* else in a DSH frame.
		*
		* ## Why `margin-right`
		*
		* The navigator's own placement is `right: calc(...)` from that package's
		* stylesheet, which this plugin must not clobber. For an absolutely positioned
		* box with `right` and a `width` but no `left`, the used `left` is
		* `cbWidth - right - width - margin-right`: a `margin-right` shifts the box left
		* without touching the app's own value, and removing the property restores it
		* exactly.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/turnnav
		*/
		/** The overlay layer carries this attribute; the layout frame is its parent. */
		const OVERLAY_ATTRIBUTE = "data-shell-overlay";
		/**
		* Breathing room left between the navigator's marks and the slab. Enough that
		* the two read as neighbours rather than as one crowded object.
		*/
		const CLEARANCE_GAP_PX = 10;
		/**
		* The conversation view's turn navigator, if it is mounted.
		*
		* Matched structurally rather than by class or label: an absolutely positioned
		* `nav` whose parent is a zero-height sticky slot. A `display: none` slot (the
		* narrow-viewport rule) still matches here, and is then filtered out by the
		* zero-width check in the geometry — a hidden navigator must not be shifted.
		*
		* @param frame - the layout frame to search.
		* @returns the navigator element, or undefined when the chat view is not shown.
		*/
		function findTurnNavigator(frame) {
			for (const candidate of frame.querySelectorAll("nav")) {
				if (!(candidate instanceof HTMLElement)) continue;
				if (getComputedStyle(candidate).position !== "absolute") continue;
				const slot = candidate.parentElement;
				if (slot === null) continue;
				if (getComputedStyle(slot).position !== "sticky") continue;
				if (slot.getBoundingClientRect().height > .5) continue;
				return candidate;
			}
		}
		/**
		* Take the shift off one navigator element, restoring its own styling.
		* @param element - the element to release, if any.
		*/
		function release(element) {
			element?.style.removeProperty("margin-right");
		}
		/**
		* Hold the turn navigator clear of the rail for as long as it is mounted.
		*
		* @param slab - the rail's painted slab, whose left edge is the boundary to
		*   clear. `null` until the rail has mounted.
		* @param active - whether the rail is on screen at all.
		* @param enabled - the user's setting; when false this never touches the app.
		* @param anchor - the edge the rail is docked to. Only a right-anchored rail can
		*   collide with the navigator; a left-anchored one must leave it alone, so the
		*   anchor is part of the effect's identity and changes it re-measures.
		* @param revision - any value that changes when the rail's footprint moves
		*   (the frame insets). The navigator's position relative to the frame changes
		*   with the sidebars, and neither box's *size* necessarily changes then, so a
		*   resize observer alone would not see it.
		*/
		function useTurnNavigatorClearance(slab, active, enabled, anchor, revision) {
			/** The shift currently applied, mirrored for the next measurement. */
			const appliedRef = (0, react.useRef)(0);
			/** The element the shift is applied to, so it can be restored. */
			const styledRef = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => {
				if (!active || !enabled || anchor !== "right" || slab === null) return;
				const found = slab.closest(`[${OVERLAY_ATTRIBUTE}]`)?.parentElement;
				if (found === void 0 || found === null) return;
				const frame = found;
				/** Measure and apply; never re-renders, so it cannot feed itself. */
				const apply = () => {
					const nav = styledRef.current;
					if (nav === null) return;
					const navRect = nav.getBoundingClientRect();
					const slabRect = slab.getBoundingClientRect();
					const next = computeTurnNavShift({
						navRight: navRect.right,
						navWidth: navRect.width,
						appliedShift: appliedRef.current,
						railLeft: slabRect.left,
						railVisible: slabRect.width > 0,
						railOnRight: anchor === "right",
						gap: CLEARANCE_GAP_PX
					});
					if (next === appliedRef.current) return;
					appliedRef.current = next;
					if (next === 0) nav.style.removeProperty("margin-right");
					else nav.style.setProperty("margin-right", `${String(next)}px`);
				};
				const sizes = new ResizeObserver(() => {
					bind();
				});
				/**
				* Re-resolve the navigator, then measure. The element is replaced whenever
				* the chat view remounts (a session switch), and a replacement arrives
				* without the shift this hook had applied.
				*/
				function bind() {
					const found = findTurnNavigator(frame) ?? null;
					if (found !== styledRef.current) {
						release(styledRef.current);
						styledRef.current = found;
						appliedRef.current = 0;
					}
					sizes.disconnect();
					sizes.observe(frame);
					if (found !== null) sizes.observe(found);
					apply();
				}
				bind();
				const structure = new MutationObserver(() => {
					bind();
				});
				structure.observe(frame, {
					childList: true,
					subtree: true
				});
				return () => {
					structure.disconnect();
					sizes.disconnect();
					release(styledRef.current);
					styledRef.current = null;
					appliedRef.current = 0;
				};
			}, [
				slab,
				active,
				enabled,
				anchor,
				revision
			]);
		}
		//#endregion
		//#region \0dsh-proxy-monitor-css:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor\src\client\QuotaRail.module.css.mjs
		const css$1 = "._6GpIHG_rail{z-index:5;pointer-events:none;align-items:center;display:flex;position:absolute;top:0;bottom:0}._6GpIHG_rail[data-anchor=right]{right:var(--dsh-pm-inset-right,0px)}._6GpIHG_rail[data-anchor=left]{left:var(--dsh-pm-inset-left,0px)}._6GpIHG_rail[data-align=top]{align-items:flex-start;padding-top:58px;bottom:auto}._6GpIHG_rail[data-align=bottom]{align-items:flex-end;padding-bottom:20px;top:auto}._6GpIHG_slab{--dsh-pm-radius:24px;--dsh-pm-scoop:54px;--dsh-pm-edge-pad:8px;--dsh-pm-card-gap:18px;pointer-events:auto;padding:12px var(--dsh-pm-edge-pad);opacity:var(--dsh-pm-rest-opacity,.82);transition:opacity var(--ds-transition-duration,.16s) var(--ds-ease-in-out,ease);flex-direction:column;align-items:center;gap:7px;display:flex;position:relative}._6GpIHG_rail[data-engaged=true] ._6GpIHG_slab{opacity:1}._6GpIHG_slabShape{z-index:0;pointer-events:none;background:var(--dsw-alias-bg-layer-3,#fff);filter:drop-shadow(0 0 .5px var(--dsw-alias-border-l4,#00000029)) drop-shadow(0 3px 12px #00000017);position:absolute;inset:0}._6GpIHG_rail[data-anchor=right] ._6GpIHG_slabShape{border-radius:var(--dsh-pm-radius) 0 0 var(--dsh-pm-radius)}._6GpIHG_rail[data-anchor=left] ._6GpIHG_slabShape{border-radius:0 var(--dsh-pm-radius) var(--dsh-pm-radius) 0}._6GpIHG_slabShape:before,._6GpIHG_slabShape:after{content:\"\";width:calc(100% - var(--dsh-pm-radius));height:var(--dsh-pm-scoop);position:absolute}._6GpIHG_rail[data-anchor=right] ._6GpIHG_slabShape:before{background:radial-gradient(ellipse 100% 100% at 0 0, transparent calc(100% - 2px), var(--dsw-alias-bg-layer-3,#fff) 100%);bottom:100%;right:0}._6GpIHG_rail[data-anchor=right] ._6GpIHG_slabShape:after{background:radial-gradient(ellipse 100% 100% at 0 100%, transparent calc(100% - 2px), var(--dsw-alias-bg-layer-3,#fff) 100%);top:100%;right:0}._6GpIHG_rail[data-anchor=left] ._6GpIHG_slabShape:before{background:radial-gradient(ellipse 100% 100% at 100% 0, transparent calc(100% - 2px), var(--dsw-alias-bg-layer-3,#fff) 100%);bottom:100%;left:0}._6GpIHG_rail[data-anchor=left] ._6GpIHG_slabShape:after{background:radial-gradient(ellipse 100% 100% at 100% 100%, transparent calc(100% - 2px), var(--dsw-alias-bg-layer-3,#fff) 100%);top:100%;left:0}._6GpIHG_slot{z-index:1;flex-direction:column;align-items:center;display:flex;position:relative}._6GpIHG_trigger{cursor:pointer;color:inherit;font:inherit;background:0 0;border:0;border-radius:50%;flex-direction:column;align-items:center;gap:3px;padding:2px;display:flex}._6GpIHG_trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:2px}._6GpIHG_ringWrap{place-items:center;width:44px;height:44px;display:grid;position:relative}._6GpIHG_ring{position:absolute;inset:0;overflow:visible}._6GpIHG_ringTrack{stroke:var(--dsw-alias-border-l3,#0000001f)}._6GpIHG_ringArc{stroke:var(--dsw-alias-state-success-primary,#22c55e);transition:stroke-dasharray var(--ds-transition-duration,.16s) var(--ds-ease-in-out,ease)}._6GpIHG_slot[data-level=warn] ._6GpIHG_ringArc{stroke:var(--dsw-alias-state-warn-primary,#f59e0b)}._6GpIHG_slot[data-level=danger] ._6GpIHG_ringArc{stroke:var(--dsw-alias-state-error-primary,#ec1313)}._6GpIHG_slot[data-level=idle] ._6GpIHG_ringArc{stroke:var(--dsw-alias-label-dimmed,#9aa3b0)}._6GpIHG_ringGlyph{color:var(--dsw-alias-label-primary,#0f1115);place-items:center;display:grid;position:relative}._6GpIHG_percent{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#61666b);font-size:11px;font-weight:600;line-height:14px}._6GpIHG_popover{z-index:10;--dsh-pm-tongue-overlap:1px;--dsh-pm-tongue-height:80px;position:absolute;top:50%;transform:translateY(-50%)}._6GpIHG_popover[data-anchor=right]{right:calc(100% + var(--dsh-pm-edge-pad) + var(--dsh-pm-card-gap))}._6GpIHG_popover[data-anchor=left]{left:calc(100% + var(--dsh-pm-edge-pad) + var(--dsh-pm-card-gap))}._6GpIHG_tongue{z-index:1;height:var(--dsh-pm-tongue-height);background:var(--dsw-alias-bg-layer-3,#fff);pointer-events:none;position:absolute;top:50%;transform:translateY(-50%)}._6GpIHG_popover[data-anchor=right] ._6GpIHG_tongue{left:calc(100% - var(--dsh-pm-tongue-overlap));width:calc(var(--dsh-pm-tongue-overlap) + var(--dsh-pm-card-gap) + var(--dsh-pm-edge-pad));clip-path:polygon(0% 0%,10% .45%,20% 1.66%,30% 3.46%,40% 5.63%,50% 8%,60% 10.37%,70% 12.54%,80% 14.34%,90% 15.55%,100% 16%,100% 84%,90% 84.45%,80% 85.66%,70% 87.46%,60% 89.63%,50% 92%,40% 94.37%,30% 96.54%,20% 98.34%,10% 99.55%,0% 100%)}._6GpIHG_popover[data-anchor=left] ._6GpIHG_tongue{right:calc(100% - var(--dsh-pm-tongue-overlap));width:calc(var(--dsh-pm-tongue-overlap) + var(--dsh-pm-card-gap) + var(--dsh-pm-edge-pad));clip-path:polygon(100% 0%,90% .45%,80% 1.66%,70% 3.46%,60% 5.63%,50% 8%,40% 10.37%,30% 12.54%,20% 14.34%,10% 15.55%,0% 16%,0% 84%,10% 84.45%,20% 85.66%,30% 87.46%,40% 89.63%,50% 92%,60% 94.37%,70% 96.54%,80% 98.34%,90% 99.55%,100% 100%)}._6GpIHG_card{background:var(--dsw-alias-bg-layer-3,#fff);border:.5px solid var(--dsw-alias-border-l2,#0000001a);width:258px;color:var(--dsw-alias-label-primary,#0f1115);z-index:0;box-shadow:var(--dsw-elevation-prominent,0 3px 20px #00000021);border-radius:14px;padding:12px 13px;position:relative}._6GpIHG_cardHead{align-items:center;gap:8px;margin-bottom:10px;display:flex}._6GpIHG_cardIcon{border:1.5px solid var(--dsw-alias-state-success-primary,#22c55e);width:26px;height:26px;color:var(--dsw-alias-label-primary,#0f1115);border-radius:50%;flex:none;place-items:center;display:grid}._6GpIHG_cardIcon[data-level=warn]{border-color:var(--dsw-alias-state-warn-primary,#f59e0b)}._6GpIHG_cardIcon[data-level=danger]{border-color:var(--dsw-alias-state-error-primary,#ec1313)}._6GpIHG_cardIcon[data-level=idle]{border-color:var(--dsw-alias-label-dimmed,#9aa3b0)}._6GpIHG_cardTitles{flex-direction:column;min-width:0;display:flex}._6GpIHG_cardName{white-space:nowrap;text-overflow:ellipsis;font-size:13px;font-weight:600;line-height:17px;overflow:hidden}._6GpIHG_cardPlan{color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:15px;overflow:hidden}._6GpIHG_windows{flex-direction:column;gap:10px;display:flex}._6GpIHG_window{flex-direction:column;gap:4px;display:flex}._6GpIHG_windowHead{justify-content:space-between;align-items:baseline;gap:8px;display:flex}._6GpIHG_windowLabel{color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap;text-overflow:ellipsis;font-size:12px;line-height:16px;overflow:hidden}._6GpIHG_windowReset{color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap;flex:none;font-size:11px;line-height:15px}._6GpIHG_bar{background:var(--dsw-alias-border-l2,#0000001a);border-radius:3px;height:6px;overflow:hidden}._6GpIHG_barFill{background:var(--dsw-alias-state-success-primary,#22c55e);height:100%;transition:width var(--ds-transition-duration,.16s) var(--ds-ease-in-out,ease);border-radius:3px}._6GpIHG_bar[data-level=warn] ._6GpIHG_barFill{background:var(--dsw-alias-state-warn-primary,#f59e0b)}._6GpIHG_bar[data-level=danger] ._6GpIHG_barFill{background:var(--dsw-alias-state-error-primary,#ec1313)}._6GpIHG_bar[data-level=idle] ._6GpIHG_barFill{background:var(--dsw-alias-label-dimmed,#9aa3b0)}._6GpIHG_barCaption{color:var(--dsw-alias-label-tertiary,#81858c);font-size:11px;line-height:15px}._6GpIHG_balanceLine{color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;line-height:17px}._6GpIHG_cardNotice{background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-secondary,#61666b);word-break:break-word;border-radius:8px;padding:6px 8px;font-size:11px;line-height:15px}._6GpIHG_cardNotice[data-tone=error]{background:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d);color:var(--dsw-alias-state-error-primary,#ec1313)}._6GpIHG_cardFoot{border-top:.5px solid var(--dsw-alias-border-l1,#0000000a);color:var(--dsw-alias-label-tertiary,#81858c);justify-content:space-between;align-items:baseline;gap:8px;margin-top:10px;padding-top:8px;font-size:11px;line-height:15px;display:flex}._6GpIHG_cardAccount{border-top:.5px solid var(--dsw-alias-border-l1,#0000000a);margin-top:10px;padding-top:10px}._6GpIHG_cardAccountName{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}._6GpIHG_cardBalance{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#61666b);flex:none}._6GpIHG_actions{z-index:1;border-top:.5px solid var(--dsw-alias-border-l2,#0000001a);flex-direction:column;align-items:center;margin-top:1px;padding-top:6px;display:flex;position:relative}._6GpIHG_action{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-tertiary,#81858c);transition:background var(--ds-transition-duration,.16s) var(--ds-ease-in-out,ease);background:0 0;border:0;border-radius:50%;place-items:center;padding:0;display:grid}._6GpIHG_action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}._6GpIHG_action:disabled{cursor:default;opacity:.55}._6GpIHG_action[data-error=true]{color:var(--dsw-alias-state-error-primary,#ec1313)}._6GpIHG_action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:1px}@media (width<=900px){._6GpIHG_popover{display:none}}@media (prefers-reduced-motion:reduce){._6GpIHG_slab,._6GpIHG_ringArc,._6GpIHG_barFill,._6GpIHG_action{transition:none}}";
		const styleId$1 = "@dsh-external/dsh-proxy-monitor/QuotaRail.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$1) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@dsh-external/dsh-proxy-monitor";
			style.dataset.pluginCss = styleId$1;
			style.textContent = css$1;
			document.head.appendChild(style);
		}
		var QuotaRail_module_css_default = {
			"percent": "_6GpIHG_percent",
			"bar": "_6GpIHG_bar",
			"cardBalance": "_6GpIHG_cardBalance",
			"actions": "_6GpIHG_actions",
			"slab": "_6GpIHG_slab",
			"action": "_6GpIHG_action",
			"cardPlan": "_6GpIHG_cardPlan",
			"card": "_6GpIHG_card",
			"balanceLine": "_6GpIHG_balanceLine",
			"windows": "_6GpIHG_windows",
			"ringArc": "_6GpIHG_ringArc",
			"barCaption": "_6GpIHG_barCaption",
			"rail": "_6GpIHG_rail",
			"cardHead": "_6GpIHG_cardHead",
			"windowLabel": "_6GpIHG_windowLabel",
			"windowReset": "_6GpIHG_windowReset",
			"tongue": "_6GpIHG_tongue",
			"cardAccount": "_6GpIHG_cardAccount",
			"cardFoot": "_6GpIHG_cardFoot",
			"trigger": "_6GpIHG_trigger",
			"slabShape": "_6GpIHG_slabShape",
			"popover": "_6GpIHG_popover",
			"slot": "_6GpIHG_slot",
			"barFill": "_6GpIHG_barFill",
			"cardNotice": "_6GpIHG_cardNotice",
			"ringWrap": "_6GpIHG_ringWrap",
			"cardAccountName": "_6GpIHG_cardAccountName",
			"windowHead": "_6GpIHG_windowHead",
			"cardTitles": "_6GpIHG_cardTitles",
			"ringGlyph": "_6GpIHG_ringGlyph",
			"cardIcon": "_6GpIHG_cardIcon",
			"window": "_6GpIHG_window",
			"cardName": "_6GpIHG_cardName",
			"ring": "_6GpIHG_ring",
			"ringTrack": "_6GpIHG_ringTrack"
		};
		//#endregion
		//#region src/client/QuotaRail.tsx
		/**
		* The quota rail: a floating column of ring gauges, one per provider.
		*
		* Visual model (from the reference design): a dark rounded slab pinned to the
		* viewport edge, each provider a circled icon whose circumference is filled by
		* the consumed share. Hovering or clicking a ring expands a detail card beside
		* it showing every metered window with its reset time.
		*
		* Two constraints shape the implementation:
		*
		* - **It must not fight the app's theme.** Every surface is drawn from the
		*   `--dsw-*` alias tokens, so the rail follows light/dark/system for free
		*   rather than carrying its own palette.
		* - **It must not block the app.** The rail lives in the frame's overlay layer
		*   (which is click-through by default) and opts back into pointer events only
		*   on its own elements; it is also faded at rest and lifts on hover or focus.
		*
		* @module @dsh-external/dsh-proxy-monitor/client/QuotaRail
		*/
		/** Ring geometry: a 44px box with a 2px stroke inset by 3px. */
		const RING_SIZE = 44;
		const RING_STROKE = 2.5;
		const RING_RADIUS = 41.5 / 2 - 2;
		const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
		/** Above this consumed share the ring turns amber; above the second, red. */
		const WARN_AT = 75;
		const DANGER_AT = 90;
		/**
		* The providers whose session this plugin can manage.
		*
		* Duplicated as a literal rather than imported from the host contract because
		* the browser half must not depend on a host-side module; the two are tied
		* together by {@link ProviderAccount}'s id union, which fails the build if they
		* ever diverge.
		*/
		const PROXIED_IDS = [
			"codex",
			"antigravity",
			"workbuddy",
			"grok"
		];
		/** The provider id to treat as proxied, or undefined when it is quota-only. */
		function proxiedId(id) {
			return PROXIED_IDS.includes(id) ? id : void 0;
		}
		/** The state class of a ring, from its consumed share. */
		function levelOf(usedPercent) {
			if (usedPercent === void 0) return "idle";
			if (usedPercent >= DANGER_AT) return "danger";
			if (usedPercent >= WARN_AT) return "warn";
			return "ok";
		}
		/** "73%" — the rail never shows a fraction of a percent. */
		function percentLabel(usedPercent) {
			return usedPercent === void 0 ? "—" : `${String(Math.round(usedPercent))}%`;
		}
		/**
		* A relative reset description ("in 51 min"), which is what a user actually
		* wants from a reset time; the absolute time goes in the row's title.
		* @param resetAt - ISO reset timestamp.
		* @param now - current epoch ms, passed in so every row in a render agrees.
		* @returns the relative label, or undefined when unparseable.
		*/
		function relativeReset(resetAt, now) {
			if (resetAt === void 0) return void 0;
			const at = Date.parse(resetAt);
			if (!Number.isFinite(at)) return void 0;
			const deltaMs = at - now;
			if (deltaMs <= 0) return "resetting";
			const minutes = Math.round(deltaMs / 6e4);
			if (minutes < 60) return `in ${String(minutes)} min`;
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return `in ${String(hours)} h`;
			return `in ${String(Math.round(hours / 24))} d`;
		}
		/** "Thu 12:00 AM" — the absolute reset label for a row's title. */
		function absoluteReset(resetAt) {
			if (resetAt === void 0) return void 0;
			const at = Date.parse(resetAt);
			if (!Number.isFinite(at)) return void 0;
			return new Date(at).toLocaleString(void 0, {
				weekday: "short",
				hour: "numeric",
				minute: "2-digit"
			});
		}
		/** One ring: the progress arc plus the provider mark. */
		function Ring({ provider }) {
			const used = provider.usedPercent;
			const ratio = used === void 0 ? 0 : Math.min(100, Math.max(0, used)) / 100;
			const level = levelOf(used);
			const dash = RING_CIRCUMFERENCE * ratio;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: QuotaRail_module_css_default.ring,
				width: RING_SIZE,
				height: RING_SIZE,
				viewBox: `0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`,
				"data-level": level,
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					className: QuotaRail_module_css_default.ringTrack,
					cx: RING_SIZE / 2,
					cy: RING_SIZE / 2,
					r: RING_RADIUS,
					fill: "none",
					strokeWidth: RING_STROKE
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					className: QuotaRail_module_css_default.ringArc,
					cx: RING_SIZE / 2,
					cy: RING_SIZE / 2,
					r: RING_RADIUS,
					fill: "none",
					strokeWidth: RING_STROKE,
					strokeLinecap: "round",
					strokeDasharray: `${String(dash)} ${String(RING_CIRCUMFERENCE - dash)}`,
					transform: `rotate(-90 ${String(RING_SIZE / 2)} ${String(RING_SIZE / 2)})`
				})]
			});
		}
		/** One window row inside a detail card. */
		function WindowRow({ window: entry, now }) {
			const relative = relativeReset(entry.resetAt, now);
			const absolute = absoluteReset(entry.resetAt);
			const title = absolute === void 0 ? void 0 : `Resets ${absolute}`;
			const used = entry.usedPercent;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: QuotaRail_module_css_default.window,
				title,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuotaRail_module_css_default.windowHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: QuotaRail_module_css_default.windowLabel,
						children: entry.label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: QuotaRail_module_css_default.windowReset,
						children: relative ?? entry.detail ?? ""
					})]
				}), used === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: QuotaRail_module_css_default.balanceLine,
					children: entry.detail ?? "—"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: QuotaRail_module_css_default.bar,
					"data-level": levelOf(used),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaRail_module_css_default.barFill,
						style: { width: `${String(Math.min(100, Math.max(0, used)))}%` }
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuotaRail_module_css_default.barCaption,
					children: [percentLabel(used), " used"]
				})] })]
			});
		}
		/** The expanded card for one provider. */
		function DetailCard({ provider, now, account, accountActions }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: QuotaRail_module_css_default.card,
				role: "dialog",
				"aria-label": `${provider.name} usage`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: QuotaRail_module_css_default.cardHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: QuotaRail_module_css_default.cardIcon,
							"data-level": levelOf(provider.usedPercent),
							children: providerMark(provider.id, 18)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: QuotaRail_module_css_default.cardTitles,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: QuotaRail_module_css_default.cardName,
								children: provider.name
							}), provider.plan !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: QuotaRail_module_css_default.cardPlan,
								children: provider.plan
							})]
						})]
					}),
					provider.status === "ok" && provider.windows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaRail_module_css_default.windows,
						children: provider.windows.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WindowRow, {
							window: entry,
							now
						}, entry.id))
					}),
					provider.status !== "ok" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaRail_module_css_default.cardNotice,
						"data-tone": provider.status,
						children: provider.error ?? "No data"
					}),
					account !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaRail_module_css_default.cardAccount,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountBlock, {
							account,
							...accountActions
						})
					}),
					(provider.account !== void 0 || provider.balance !== void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: QuotaRail_module_css_default.cardFoot,
						children: [provider.account !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: QuotaRail_module_css_default.cardAccountName,
							children: provider.account
						}), provider.balance !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: QuotaRail_module_css_default.cardBalance,
							children: provider.balance
						})]
					})
				]
			});
		}
		/**
		* The floating rail.
		* @param props - providers, layout, and refresh wiring.
		* @returns the rail element.
		*/
		function QuotaRail(props) {
			const { providers, order, layout, busy, transportError, yieldToTurnNav, onRefresh, accounts, accountActions } = props;
			const [openId, setOpenId] = (0, react.useState)(void 0);
			const [hoverId, setHoverId] = (0, react.useState)(void 0);
			const [engaged, setEngaged] = (0, react.useState)(false);
			const [host, setHost] = (0, react.useState)(null);
			const [slab, setSlab] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const slabRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				setHost(rootRef.current);
				setSlab(slabRef.current);
			}, []);
			const insets = useFrameInsets(host, true);
			useTurnNavigatorClearance(slab, true, yieldToTurnNav, layout.anchor, `${String(insets.sidebar)}:${String(insets.rightbar)}`);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, 6e4);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			(0, react.useEffect)(() => {
				if (openId === void 0 && hoverId === void 0) return;
				const onKey = (event) => {
					if (event.key !== "Escape") return;
					setOpenId(void 0);
					setHoverId(void 0);
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [openId, hoverId]);
			(0, react.useEffect)(() => {
				if (openId === void 0) return;
				const onPointerDown = (event) => {
					const root = rootRef.current;
					if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
					setOpenId(void 0);
				};
				window.addEventListener("pointerdown", onPointerDown, true);
				return () => {
					window.removeEventListener("pointerdown", onPointerDown, true);
				};
			}, [openId]);
			const ordered = (0, react.useMemo)(() => {
				if (layout.sortAlphabetically) return [...providers].sort((left, right) => left.name.localeCompare(right.name));
				const rank = new Map(order.map((id, index) => [id, index]));
				return [...providers].sort((left, right) => (rank.get(left.id) ?? 99) - (rank.get(right.id) ?? 99));
			}, [
				providers,
				order,
				layout.sortAlphabetically
			]);
			const expandedId = layout.expandOnHover ? hoverId ?? openId : openId;
			/** Account rows keyed by provider, so the card's lookup is O(1) per render. */
			const accountById = (0, react.useMemo)(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
			const toggle = (0, react.useCallback)((id) => {
				setOpenId((current) => current === id ? void 0 : id);
			}, []);
			const style = (0, react.useMemo)(() => ({
				"--dsh-pm-rest-opacity": String(layout.restingOpacity / 100),
				"--dsh-pm-inset-left": `${String(insets.sidebar)}px`,
				"--dsh-pm-inset-right": `${String(insets.rightbar)}px`
			}), [
				layout.restingOpacity,
				insets.sidebar,
				insets.rightbar
			]);
			if (insets.rightbarFullscreen) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: QuotaRail_module_css_default.rail,
				style,
				"data-anchor": layout.anchor,
				"data-align": layout.align,
				"data-engaged": engaged || expandedId !== void 0 ? "true" : void 0,
				onPointerEnter: () => {
					setEngaged(true);
				},
				onPointerLeave: () => {
					setEngaged(false);
					setHoverId(void 0);
				},
				onFocusCapture: () => {
					setEngaged(true);
				},
				onBlurCapture: (event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) setEngaged(false);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuotaRail_module_css_default.slab,
					ref: slabRef,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: QuotaRail_module_css_default.slabShape,
							"aria-hidden": "true"
						}),
						ordered.map((provider) => {
							const expanded = expandedId === provider.id;
							const level = levelOf(provider.usedPercent);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: QuotaRail_module_css_default.slot,
								"data-level": level,
								onPointerEnter: () => {
									if (layout.expandOnHover) setHoverId(provider.id);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: QuotaRail_module_css_default.trigger,
									"aria-expanded": expanded,
									"aria-label": `${provider.name} usage, ${percentLabel(provider.usedPercent)} used`,
									onClick: () => {
										toggle(provider.id);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: QuotaRail_module_css_default.ringWrap,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ring, { provider }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: QuotaRail_module_css_default.ringGlyph,
											children: providerMark(provider.id, 18)
										})]
									}), layout.showPercent && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: QuotaRail_module_css_default.percent,
										children: percentLabel(provider.usedPercent)
									})]
								}), expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: QuotaRail_module_css_default.popover,
									"data-anchor": layout.anchor,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: QuotaRail_module_css_default.tongue,
										"aria-hidden": "true"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailCard, {
										provider,
										now,
										account: (() => {
											const proxied = proxiedId(provider.id);
											return proxied === void 0 ? void 0 : accountById.get(proxied);
										})(),
										accountActions
									})]
								})]
							}, provider.id);
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: QuotaRail_module_css_default.actions,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: QuotaRail_module_css_default.action,
								onClick: onRefresh,
								disabled: busy,
								"aria-label": "Refresh usage",
								title: transportError ?? "Refresh usage",
								"data-error": transportError === void 0 ? void 0 : "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
									width: 15,
									height: 15,
									viewBox: "0 0 24 24",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "2",
									"aria-hidden": "true",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d: "M20 11a8 8 0 1 0-2.3 5.7",
										strokeLinecap: "round"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d: "M20 4.5V11h-6.4",
										strokeLinecap: "round",
										strokeLinejoin: "round"
									})]
								})
							})
						})
					]
				})
			});
		}
		//#endregion
		//#region \0dsh-proxy-monitor-css:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor\src\client\Settings.module.css.mjs
		const css = ".xHtmeW_section{flex-direction:column;gap:22px;max-width:720px;padding:4px 2px 24px;display:flex}.xHtmeW_header{flex-direction:column;gap:6px;display:flex}.xHtmeW_heading{color:var(--dsw-alias-label-primary,#0f1115);margin:0;font-size:15px;font-weight:600;line-height:22px}.xHtmeW_lead{color:var(--dsw-alias-label-tertiary,#81858c);margin:0;font-size:12px;line-height:18px}.xHtmeW_group{background:var(--dsw-alias-bg-layer-1,#fff);border:.5px solid var(--dsw-alias-border-l1,#0000000a);border-radius:12px;flex-direction:column;gap:2px;padding:12px 14px;display:flex}body[data-ds-dark-theme] .xHtmeW_group{background:var(--dsw-alias-bg-layer-1,#232324)}.xHtmeW_groupTitle{letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#61666b);margin:0 0 8px;font-size:12px;font-weight:600;line-height:16px}.xHtmeW_groupHint{color:var(--dsw-alias-label-tertiary,#81858c);margin:0 0 8px;font-size:12px;line-height:18px}.xHtmeW_row{cursor:pointer;justify-content:space-between;align-items:center;gap:16px;padding:8px 0;display:flex}.xHtmeW_row+.xHtmeW_row{border-top:.5px solid var(--dsw-alias-border-l1,#0000000a)}.xHtmeW_rowText{flex-direction:column;gap:2px;min-width:0;display:flex}.xHtmeW_rowTitle{color:var(--dsw-alias-label-primary,#0f1115);font-size:13px;line-height:18px}.xHtmeW_rowDesc{color:var(--dsw-alias-label-tertiary,#81858c);font-size:11px;line-height:16px}.xHtmeW_switch{cursor:pointer;appearance:none;background:var(--dsw-alias-border-l3,#0000001f);width:34px;height:20px;transition:background var(--ds-transition-duration,.16s) var(--ds-ease-in-out,ease);border-radius:10px;flex:none;margin:0;position:relative}.xHtmeW_switch:after{content:\"\";background:var(--dsw-alias-bg-layer-1,#fff);width:16px;height:16px;transition:transform var(--ds-transition-duration,.16s) var(--ds-ease-in-out,ease);border-radius:50%;position:absolute;top:2px;left:2px;box-shadow:0 1px 3px #0000002e}.xHtmeW_switch:checked{background:var(--dsw-alias-button-primary-fill,#0f1115)}.xHtmeW_switch:checked:after{transform:translate(14px)}.xHtmeW_switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:2px}.xHtmeW_segmented{background:var(--dsw-alias-interactive-bg-hover,#2631480f);border-radius:8px;flex:none;gap:2px;padding:2px;display:inline-flex}.xHtmeW_segment{cursor:pointer;color:var(--dsw-alias-label-secondary,#61666b);background:0 0;border:0;border-radius:6px;padding:3px 10px;font-size:12px;line-height:16px}.xHtmeW_segment[data-active=true]{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);box-shadow:var(--dsw-shadow-lv3,0 1px 2px #00000014)}body[data-ds-dark-theme] .xHtmeW_segment[data-active=true]{background:var(--dsw-alias-bg-layer-3,#353638)}.xHtmeW_segment:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:1px}.xHtmeW_sliderWrap{flex:none;align-items:center;gap:10px;display:inline-flex}.xHtmeW_slider{cursor:pointer;width:150px;accent-color:var(--dsw-alias-button-primary-fill,#0f1115);margin:0}.xHtmeW_sliderValue{text-align:right;font-variant-numeric:tabular-nums;min-width:52px;color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;line-height:16px}.xHtmeW_button{border:.5px solid var(--dsw-alias-border-l3,#0000001f);background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;color:var(--dsw-alias-label-primary,#0f1115);border-radius:8px;flex:none;padding:5px 12px;font-size:12px;line-height:16px}.xHtmeW_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}.xHtmeW_button:disabled{cursor:default;opacity:.55}.xHtmeW_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:1px}.xHtmeW_providerList{border:.5px solid var(--dsw-alias-border-l1,#0000000a);border-radius:10px;flex-direction:column;margin:0;padding:0;list-style:none;display:flex;overflow:hidden}.xHtmeW_providerRow{background:var(--dsw-alias-bg-layer-1,#fff);align-items:center;gap:10px;padding:9px 11px;display:flex}.xHtmeW_providerRow+.xHtmeW_providerRow{border-top:.5px solid var(--dsw-alias-border-l1,#0000000a)}.xHtmeW_providerRow[data-on=false]{background:var(--dsw-alias-interactive-bg-hover,#26314808)}.xHtmeW_checkbox{cursor:pointer;width:15px;height:15px;accent-color:var(--dsw-alias-button-primary-fill,#0f1115);flex:none;margin:0}.xHtmeW_providerMark{width:20px;height:20px;color:var(--dsw-alias-label-dimmed,#9aa3b0);flex:none;place-items:center;display:grid}.xHtmeW_providerMark[data-available=true]{color:var(--dsw-alias-label-primary,#0f1115)}.xHtmeW_providerText{flex-direction:column;flex:auto;gap:1px;min-width:0;display:flex}.xHtmeW_providerName{color:var(--dsw-alias-label-primary,#0f1115);font-size:13px;line-height:18px}.xHtmeW_providerSummary{color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:16px;overflow:hidden}.xHtmeW_orderButtons{flex:none;gap:2px;display:inline-flex}.xHtmeW_orderButton{cursor:pointer;width:22px;height:22px;color:var(--dsw-alias-label-secondary,#61666b);background:0 0;border:0;border-radius:6px;padding:0;font-size:12px;line-height:1}.xHtmeW_orderButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}.xHtmeW_orderButton:disabled{opacity:.3;cursor:default}.xHtmeW_orderButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:1px}";
		const styleId = "@dsh-external/dsh-proxy-monitor/Settings.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@dsh-external/dsh-proxy-monitor";
			style.dataset.pluginCss = styleId;
			style.textContent = css;
			document.head.appendChild(style);
		}
		var Settings_module_css_default = {
			"orderButton": "xHtmeW_orderButton",
			"rowDesc": "xHtmeW_rowDesc",
			"heading": "xHtmeW_heading",
			"switch": "xHtmeW_switch",
			"groupTitle": "xHtmeW_groupTitle",
			"section": "xHtmeW_section",
			"orderButtons": "xHtmeW_orderButtons",
			"lead": "xHtmeW_lead",
			"sliderWrap": "xHtmeW_sliderWrap",
			"providerRow": "xHtmeW_providerRow",
			"providerMark": "xHtmeW_providerMark",
			"slider": "xHtmeW_slider",
			"groupHint": "xHtmeW_groupHint",
			"checkbox": "xHtmeW_checkbox",
			"providerSummary": "xHtmeW_providerSummary",
			"button": "xHtmeW_button",
			"sliderValue": "xHtmeW_sliderValue",
			"row": "xHtmeW_row",
			"providerList": "xHtmeW_providerList",
			"group": "xHtmeW_group",
			"header": "xHtmeW_header",
			"segment": "xHtmeW_segment",
			"providerName": "xHtmeW_providerName",
			"segmented": "xHtmeW_segmented",
			"providerText": "xHtmeW_providerText",
			"rowText": "xHtmeW_rowText",
			"rowTitle": "xHtmeW_rowTitle"
		};
		//#endregion
		//#region src/client/Settings.tsx
		/**
		* The plugin's settings section.
		*
		* This is a first-class section in the Settings panel (its own left-nav row),
		* not a General-page row: the plugin has enough options — provider roster,
		* placement, opacity, polling — that a single row would bury them.
		*
		* Writes go through the shared `configForms` entry form, so the values live in
		* this plugin's entry config inside the profile patch — the one place the Host
		* reads them from — and the rail follows a change immediately (the Host watches
		* the same references and re-points the collector live).
		*
		* @module @dsh-external/dsh-proxy-monitor/client/Settings
		*/
		/** Display metadata for providers this plugin can show. */
		const PROVIDER_LABELS = {
			deepseek: "DeepSeek",
			codex: "Codex",
			workbuddy: "WorkBuddy",
			antigravity: "Antigravity",
			grok: "Grok",
			claude: "Claude"
		};
		/** Every provider id this plugin knows, in default display order. */
		const KNOWN_PROVIDERS = Object.keys(PROVIDER_LABELS);
		/** One-line status for a provider row. */
		function summarize(provider) {
			if (provider === void 0) return "尚未读取";
			if (provider.status === "unconfigured") return provider.error ?? "未配置";
			if (provider.status === "error") return provider.error ?? "读取失败";
			if (provider.usedPercent !== void 0) return `${String(Math.round(provider.usedPercent))}% 已用`;
			return provider.balance === void 0 ? "已连接" : `余额 ${provider.balance}`;
		}
		/** A labelled switch row. */
		function ToggleRow({ title, description, checked, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: Settings_module_css_default.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Settings_module_css_default.rowText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Settings_module_css_default.rowTitle,
						children: title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Settings_module_css_default.rowDesc,
						children: description
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					className: Settings_module_css_default.switch,
					checked,
					onChange: (event) => {
						onChange(event.target.checked);
					}
				})]
			});
		}
		/** A segmented choice row. */
		function ChoiceRow({ title, description, value, choices, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Settings_module_css_default.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Settings_module_css_default.rowText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Settings_module_css_default.rowTitle,
						children: title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Settings_module_css_default.rowDesc,
						children: description
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: Settings_module_css_default.segmented,
					children: choices.map((choice) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: Settings_module_css_default.segment,
						"data-active": choice.value === value ? "true" : void 0,
						onClick: () => {
							onChange(choice.value);
						},
						children: choice.label
					}, choice.value))
				})]
			});
		}
		/** A numeric row backed by a range plus its current value. */
		function SliderRow({ title, description, value, min, max, step = 1, suffix, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: Settings_module_css_default.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Settings_module_css_default.rowText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Settings_module_css_default.rowTitle,
						children: title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Settings_module_css_default.rowDesc,
						children: description
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Settings_module_css_default.sliderWrap,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "range",
						className: Settings_module_css_default.slider,
						min,
						max,
						step,
						value,
						onChange: (event) => {
							onChange(Number(event.target.value));
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: Settings_module_css_default.sliderValue,
						children: [value, suffix ?? ""]
					})]
				})]
			});
		}
		/**
		* The settings section.
		*
		* It reads settings through the store's subscription rather than through its
		* injected props, because the slot framework calls `inject` once per
		* registration: a value captured there would be frozen at mount and the page
		* would never show a reopened value.
		*
		* @param props - the injected face.
		* @returns the section element.
		*/
		function ProxyMonitorSettings(props) {
			const { store, broker, shared, write } = props;
			const [settings, setSettings] = (0, react.useState)(() => store.getSnapshot());
			(0, react.useEffect)(() => {
				setSettings(store.getSnapshot());
				return store.subscribe(() => {
					setSettings(store.getSnapshot());
				});
			}, [store]);
			const [snapshot, setSnapshot] = (0, react.useState)(() => shared.snapshot);
			const [busy, setBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let live = true;
				if (shared.snapshot !== void 0) {
					setSnapshot(shared.snapshot);
					return;
				}
				setBusy(true);
				broker.snapshot().then((next) => {
					if (!live) return;
					shared.snapshot = next;
					setSnapshot(next);
				}).catch(() => {}).finally(() => {
					if (live) setBusy(false);
				});
				return () => {
					live = false;
				};
			}, [broker, shared]);
			const refresh = () => {
				setBusy(true);
				broker.refresh().then((result) => {
					shared.snapshot = result.snapshot;
					setSnapshot(result.snapshot);
				}).catch(() => {}).finally(() => {
					setBusy(false);
				});
			};
			const byId = (0, react.useMemo)(() => new Map((snapshot?.providers ?? []).map((provider) => [provider.id, provider])), [snapshot]);
			const selected = (0, react.useMemo)(() => new Set(settings.providers), [settings.providers]);
			const chosen = (0, react.useMemo)(() => settings.providers.filter((id) => KNOWN_PROVIDERS.includes(id)), [settings.providers]);
			const rest = (0, react.useMemo)(() => KNOWN_PROVIDERS.filter((id) => !selected.has(id)), [selected]);
			const toggleProvider = (id) => {
				const next = selected.has(id) ? settings.providers.filter((entry) => entry !== id) : [...settings.providers, id];
				write("providers", next);
			};
			const move = (id, delta) => {
				const list = [...settings.providers];
				const from = list.indexOf(id);
				const to = from + delta;
				if (from < 0 || to < 0 || to >= list.length) return;
				const [moved] = list.splice(from, 1);
				if (moved === void 0) return;
				list.splice(to, 0, moved);
				write("providers", list);
			};
			/** One roster row, shared by the selected and unselected halves. */
			const renderRow = (id, index, total) => {
				const provider = byId.get(id);
				const on = selected.has(id);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: Settings_module_css_default.providerRow,
					"data-on": on ? "true" : "false",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							className: Settings_module_css_default.checkbox,
							checked: on,
							onChange: () => {
								toggleProvider(id);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Settings_module_css_default.providerMark,
							"data-available": provider?.status === "ok" ? "true" : void 0,
							children: providerMark(id, 16)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: Settings_module_css_default.providerText,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Settings_module_css_default.providerName,
								children: PROVIDER_LABELS[id] ?? id
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Settings_module_css_default.providerSummary,
								children: summarize(provider)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Settings_module_css_default.orderButtons,
							children: on && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Settings_module_css_default.orderButton,
								disabled: index === 0,
								"aria-label": `上移 ${PROVIDER_LABELS[id] ?? id}`,
								onClick: () => {
									move(id, -1);
								},
								children: "↑"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Settings_module_css_default.orderButton,
								disabled: index === total - 1,
								"aria-label": `下移 ${PROVIDER_LABELS[id] ?? id}`,
								onClick: () => {
									move(id, 1);
								},
								children: "↓"
							})] })
						})
					]
				}, id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Settings_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: Settings_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: Settings_module_css_default.heading,
							children: "额度监控"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: Settings_module_css_default.lead,
							children: "在界面边缘显示一个悬浮的圆环侧栏，实时展示各提供商的额度消耗。悬停或点击圆环可展开详情卡片。"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: Settings_module_css_default.group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: Settings_module_css_default.groupTitle,
								children: "显示"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
								title: "启用侧栏",
								description: "关闭后侧栏隐藏，设置与数据读取保持不变",
								checked: settings.enabled,
								onChange: (next) => {
									write("enabled", next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
								title: "显示百分比数字",
								description: "在圆环下方显示消耗百分比",
								checked: settings.showPercent,
								onChange: (next) => {
									write("showPercent", next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
								title: "悬停即展开",
								description: "关闭后需点击圆环才展开详情卡",
								checked: settings.expandOnHover,
								onChange: (next) => {
									write("expandOnHover", next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
								title: "按名称排序",
								description: "关闭则按下方提供商的排列顺序显示",
								checked: settings.sortAlphabetically,
								onChange: (next) => {
									write("sortAlphabetically", next);
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: Settings_module_css_default.group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: Settings_module_css_default.groupTitle,
								children: "位置与外观"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceRow, {
								title: "贴靠边缘",
								description: "侧栏停靠在哪一侧",
								value: settings.anchor,
								choices: [{
									value: "right",
									label: "右侧"
								}, {
									value: "left",
									label: "左侧"
								}],
								onChange: (next) => {
									write("anchor", next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceRow, {
								title: "垂直位置",
								description: "侧栏在屏幕上的高度位置",
								value: settings.align,
								choices: [
									{
										value: "center",
										label: "居中"
									},
									{
										value: "top",
										label: "顶部"
									},
									{
										value: "bottom",
										label: "底部"
									}
								],
								onChange: (next) => {
									write("align", next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								title: "静置透明度",
								description: "未悬停时的透明度，越低越不干扰阅读",
								value: settings.restingOpacity,
								min: 20,
								max: 100,
								suffix: "%",
								onChange: (next) => {
									write("restingOpacity", next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
								title: "让开轮次导航条",
								description: "侧栏与对话轮次导航条重叠时，把导航条向左推开，而不是遮住它",
								checked: settings.yieldToTurnNav,
								onChange: (next) => {
									write("yieldToTurnNav", next);
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: Settings_module_css_default.group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: Settings_module_css_default.groupTitle,
								children: "数据"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								title: "刷新间隔",
								description: "超过该时间后再次读取各提供商额度",
								value: settings.refreshSeconds,
								min: 15,
								max: 600,
								step: 15,
								suffix: " 秒",
								onChange: (next) => {
									write("refreshSeconds", next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Settings_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: Settings_module_css_default.rowText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Settings_module_css_default.rowTitle,
										children: "立即刷新"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Settings_module_css_default.rowDesc,
										children: snapshot === void 0 ? "尚未读取" : `上次读取 ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Settings_module_css_default.button,
									onClick: refresh,
									disabled: busy,
									children: busy ? "读取中…" : "刷新"
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: Settings_module_css_default.group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: Settings_module_css_default.groupTitle,
								children: "提供商"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: Settings_module_css_default.groupHint,
								children: "勾选要在侧栏显示的提供商。顺序即侧栏中的排列顺序，可用箭头调整。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
								className: Settings_module_css_default.providerList,
								children: [chosen.map((id, index) => renderRow(id, index, chosen.length)), rest.map((id) => renderRow(id, -1, 0))]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* dsh-proxy-monitor, browser half.
		*
		* Registers two surfaces and nothing else:
		*
		* 1. **The rail** into `shell.overlay` — the frame's floating layer. That slot
		*    is a `list`, so this entry sits beside whatever else is there rather than
		*    replacing it, and the layer is click-through until an entry opts into
		*    pointer events, so the rail can never block the app underneath. This is
		*    the documented seat for a frame-wide surface and is why the plugin needs
		*    no change to the sidebar, the conversation, or the layout.
		* 2. **A settings section** into `settings.section`, giving the plugin its own
		*    row in the Settings panel.
		*
		* The client never reads a credential: it asks the Host for a snapshot over
		* the plugin-owned Connection RPC channel.
		*
		* @module @dsh-external/dsh-proxy-monitor/client
		*/
		/**
		* Required browser services.
		*
		* `configForms` is the settings domain's client-side form service: the form for
		* the `dsh-proxy-monitor` entry is what carries this plugin's options, so the
		* rail and the settings section always read and write the same values.
		*
		* There is no `connection` here: this plugin's Host routes are exact POST routes
		* on Connection's shared `/api` channel, reached with a plain same-origin
		* `fetch` (see `api.ts`), so the browser half needs no RPC client.
		*/
		const inject = ["slots", "configForms"];
		/** The settings section's position in the Settings nav. */
		const SETTINGS_ORDER = 40;
		/** Settings used before the Host's section arrives. Mirrors the Host schema. */
		const FALLBACK_SETTINGS = {
			enabled: true,
			providers: [
				"deepseek",
				"codex",
				"workbuddy",
				"antigravity",
				"grok"
			],
			anchor: "right",
			align: "center",
			restingOpacity: 82,
			showPercent: true,
			expandOnHover: true,
			refreshSeconds: 60,
			sortAlphabetically: false,
			yieldToTurnNav: true
		};
		/**
		* A live subscription to the plugin settings held in the Host document.
		*
		* Modelled as a tiny observable rather than reaching for a state library: the
		* store is one object, two surfaces read it, and the slot framework's own
		* contract is a `getSnapshot`/`subscribe` pair.
		*/
		var SettingsStore = class {
			value = FALLBACK_SETTINGS;
			listeners = /* @__PURE__ */ new Set();
			/** The current settings; identity is stable until a write commits. */
			getSnapshot() {
				return this.value;
			}
			/** Observe commits. */
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/** Adopt a value read from the Host scope. */
			adopt(next) {
				if (next === void 0) return;
				this.value = next;
				for (const listener of this.listeners) listener();
			}
		};
		/** Subscribe a component to the settings store. */
		function useSettings(store) {
			const [value, setValue] = (0, react.useState)(() => store.getSnapshot());
			(0, react.useEffect)(() => {
				setValue(store.getSnapshot());
				return store.subscribe(() => {
					setValue(store.getSnapshot());
				});
			}, [store]);
			return value;
		}
		/**
		* The rail: owns the polling loop and hands the rail its data.
		*
		* Polling lives in the browser half rather than on the Host so an idle browser
		* stops asking, and the interval is the one the user chose; the Host caches for
		* the same window, so the two cannot multiply requests.
		* @param props - live settings, the snapshot broker, and the shared account state.
		* @returns the rail, or null while it has nothing to show.
		*/
		function RailHost({ settings, broker, accounts }) {
			const [snapshot, setSnapshot] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			const [transportError, setTransportError] = (0, react.useState)(void 0);
			const [nonce, setNonce] = (0, react.useState)(0);
			const accountState = useAccounts(accounts);
			(0, react.useEffect)(() => {
				let live = true;
				const load = async (force) => {
					if (!live) return;
					setBusy(true);
					try {
						const next = force ? (await broker.refresh()).snapshot : await broker.snapshot();
						if (!live) return;
						setSnapshot(next);
						setTransportError(void 0);
					} catch (error) {
						if (!live) return;
						setTransportError(error instanceof Error ? error.message : String(error));
					} finally {
						if (live) setBusy(false);
					}
				};
				load(nonce > 0);
				const periodMs = Math.max(15, settings.refreshSeconds) * 1e3;
				const timer = window.setInterval(() => {
					if (document.visibilityState === "visible") load(false);
				}, periodMs);
				const onVisible = () => {
					if (document.visibilityState === "visible") load(false);
				};
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					live = false;
					window.clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, [
				broker,
				settings.refreshSeconds,
				nonce
			]);
			const layout = {
				anchor: settings.anchor,
				align: settings.align,
				restingOpacity: settings.restingOpacity,
				showPercent: settings.showPercent,
				expandOnHover: settings.expandOnHover,
				sortAlphabetically: settings.sortAlphabetically
			};
			const accountActions = {
				onLogin: (id) => {
					accounts.login(id);
				},
				onLogout: (id) => {
					accounts.logout(id);
				},
				busyId: accountState.busyId,
				ticket: accountState.ticket
			};
			if (!settings.enabled) return null;
			const providers = snapshot?.providers.filter((provider) => settings.providers.includes(provider.id)) ?? [];
			if (providers.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaRail, {
				providers,
				order: settings.providers,
				layout,
				busy,
				transportError,
				yieldToTurnNav: settings.yieldToTurnNav,
				accounts: accountState.accounts,
				accountActions,
				onRefresh: () => {
					setNonce((current) => current + 1);
				}
			});
		}
		/**
		* The unified reverse-proxy settings section.
		*
		* Reads the same {@link AccountStore} the rail uses, so the two surfaces never
		* disagree about login state, and renders the shared shell with one tab per
		* provider. It also owns the quota read that verifies a login: the numbers come
		* from the same snapshot the rail meters, so a successful login shows up in both
		* places at once rather than only where the user happens to be looking.
		*
		* @param props - the shared account store plus the snapshot broker.
		* @returns the section element.
		*/
		function ProxyAccountsSection({ accounts, broker }) {
			const state = useAccounts(accounts);
			const tabs = buildProviderTabs(state.accounts);
			const [snapshot, setSnapshot] = (0, react.useState)(void 0);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const load = (0, react.useCallback)(async (force) => {
				setRefreshing(true);
				try {
					const next = force ? (await broker.refresh()).snapshot : await broker.snapshot();
					setSnapshot(next);
				} catch {} finally {
					setRefreshing(false);
				}
			}, [broker]);
			(0, react.useEffect)(() => {
				load(false);
			}, [load]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionShell, {
				tabs,
				accounts: state.accounts,
				quotas: snapshot?.providers ?? [],
				loading: state.loading,
				refreshing,
				snapshotAt: snapshot?.fetchedAt,
				transportError: state.error,
				onLogin: (id) => {
					accounts.login(id);
				},
				onLogout: (id) => {
					accounts.logout(id);
				},
				onRefreshQuota: () => {
					load(true);
				},
				busyId: state.busyId,
				ticket: state.ticket
			});
		}
		/**
		* Browser plugin body.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const context = ctx;
			const broker = createQuotaBroker(createProxyMonitorTransport());
			const form = context.configForms.get(PROXY_MONITOR_ENTRY);
			const store = new SettingsStore();
			store.adopt(form.getSnapshot().value);
			ctx.effect(() => {
				const sync = () => {
					store.adopt(form.getSnapshot().value);
				};
				sync();
				return form.subscribe(sync);
			}, "dsh-proxy-monitor: settings subscription");
			const shared = { snapshot: void 0 };
			const accounts = new AccountStore(broker);
			ctx.effect(() => () => {
				accounts.dispose();
			}, "dsh-proxy-monitor: account store");
			ctx.effect(() => context.slots.inject("shell.overlay", () => context.slots.register({
				name: "shell.overlay",
				id: "dsh-proxy-monitor",
				order: 40
			}, function ProxyMonitorOverlay() {
				const settings = useSettings(store);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RailHost, {
					settings,
					broker,
					accounts
				});
			})), "dsh-proxy-monitor: overlay registration");
			ctx.effect(() => context.slots.inject("settings.section", () => context.slots.register({
				name: "settings.section",
				id: "dsh-proxy-monitor",
				order: SETTINGS_ORDER,
				label: () => "额度监控",
				inject: () => ({
					store,
					broker,
					shared,
					write: (field, value) => {
						form.set(field, value);
					}
				})
			}, ProxyMonitorSettings)), "dsh-proxy-monitor: settings section");
			ctx.effect(() => context.slots.inject("settings.section", () => context.slots.register({
				name: "settings.section",
				id: "dsh-proxy-monitor-accounts",
				order: 41,
				label: () => "订阅反代"
			}, function ProxyAccountsSlot() {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProxyAccountsSection, {
					accounts,
					broker
				});
			})), "dsh-proxy-monitor: accounts section");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map