export declare const COMPATIBILITY_SCHEMA_VERSION: 1;
export declare const SUPPORTED_NODE_RANGE = "^22.19.0 || >=24.0.0";
/**
 * Plugin-API generation this build is written against.
 *
 * Bumped with the 0.1.7 port: the settings seam that used to expose
 * `register(ns, schema)` was replaced by entry-keyed Config forms, and the
 * browser platform dropped `@deepseek-ai/dsh-client-runtime`. This constant is
 * the one place the diagnostic compares against, so it must name the generation
 * the code actually targets rather than a version range.
 */
export declare const SUPPORTED_DSH_PLUGIN_API_VERSION = "0.1.7-rc.2";
export declare const SUPPORTED_PI_AI_VERSION = "0.85.1";
export declare const PI_AI_PACKAGE = "@earendil-works/pi-ai";
export declare const DSH_PLUGIN_API_PACKAGES: readonly ["@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-atomic-write", "@deepseek-ai/dsh-attachment", "@deepseek-ai/dsh-home-paths", "@deepseek-ai/dsh-host-webserver", "@deepseek-ai/dsh-invariants", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-llm-pi-ai", "@deepseek-ai/dsh-fs", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-settings", "@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-web"];
export declare const COMPATIBILITY_PACKAGES: readonly ["@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-llm-pi-ai", "@earendil-works/pi-ai"];
export type CompatibilityPackageName = (typeof COMPATIBILITY_PACKAGES)[number];
export type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown';
export interface CompatibilityEntry {
    supported: string;
    installed: string | null;
    status: CompatibilityStatus;
}
export interface CompatibilityReport {
    schemaVersion: typeof COMPATIBILITY_SCHEMA_VERSION;
    status: CompatibilityStatus;
    node: CompatibilityEntry;
    packages: Record<CompatibilityPackageName, CompatibilityEntry>;
}
export interface CompatibilityEvaluationInput {
    /** Node version to evaluate; defaults to the running process in detectCompatibility. */
    nodeVersion?: string | null;
    /** Alias accepted by callers that already group installed values. */
    node?: string | null;
    /** Installed package versions keyed by package name. */
    packageVersions?: Partial<Record<CompatibilityPackageName, string | null | undefined>>;
    /** Alias accepted by callers that already group installed values. */
    packages?: Partial<Record<CompatibilityPackageName, string | null | undefined>>;
    /** Nested installed values are useful when feeding a captured diagnostic fixture. */
    installed?: {
        node?: string | null;
        packages?: Partial<Record<CompatibilityPackageName, string | null | undefined>>;
    };
}
export interface CompatibilityDetectionOptions extends CompatibilityEvaluationInput {
    /** Test seam for package metadata resolution; no package paths are returned. */
    readPackageVersion?: (name: CompatibilityPackageName) => string | null | undefined | Promise<string | null | undefined>;
}
/** Public contract data mirrored by compatibility.json without importing JSON at runtime. */
export declare const COMPATIBILITY_CONTRACT: {
    readonly schemaVersion: 1;
    readonly engines: {
        readonly node: "^22.19.0 || >=24.0.0";
    };
    readonly dshPluginApi: {
        readonly version: "0.1.7-rc.2";
        readonly packages: readonly ["@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-atomic-write", "@deepseek-ai/dsh-attachment", "@deepseek-ai/dsh-home-paths", "@deepseek-ai/dsh-host-webserver", "@deepseek-ai/dsh-invariants", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-llm-pi-ai", "@deepseek-ai/dsh-fs", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-settings", "@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-web"];
    };
    readonly piAi: {
        readonly package: "@earendil-works/pi-ai";
        readonly version: "0.85.1";
    };
};
/** Evaluate a captured set of versions without touching the filesystem. */
export declare function evaluateCompatibility(input?: CompatibilityEvaluationInput): CompatibilityReport;
/** Alias for callers that prefer assessment terminology. */
export declare const assessCompatibility: typeof evaluateCompatibility;
/** Read installed package metadata and return only versions and statuses. */
export declare function detectCompatibility(options?: CompatibilityDetectionOptions): Promise<CompatibilityReport>;
