/**
 * Resolution of the DSH home directory.
 *
 * The installed `@deepseek-ai/dsh-home-paths` package is the canonical source,
 * but it is a host-only dependency this plugin must not require (a sibling
 * plugin may be installed without it, and the purity rules keep the browser
 * half free of Node-only imports). The resolution order here mirrors the
 * convention the rest of the ecosystem uses:
 *
 * 1. `DSH_HOME`, when set and non-empty — the documented override;
 * 2. `~/.dsh` — the default profile root.
 *
 * @module @dsh-external/dsh-proxy-monitor/home
 */
/**
 * Resolve the DSH home directory.
 * @param env - environment to read; defaults to the process environment.
 * @returns the absolute home directory path.
 */
export declare function resolveDshHome(env?: NodeJS.ProcessEnv): string;
