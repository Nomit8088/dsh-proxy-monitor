export declare const COMPATIBILITY_SCHEMA_VERSION: 1;
export declare const SUPPORTED_NODE_RANGE = "^22.19.0 || >=24.0.0";
export declare const SUPPORTED_DSH_PLUGIN_API_VERSION = "0.1.1-rc.2";
export declare const SUPPORTED_PI_AI_VERSION = "0.84.4";
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
        readonly version: "0.1.1-rc.2";
        readonly packages: readonly ["@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-atomic-write", "@deepseek-ai/dsh-attachment", "@deepseek-ai/dsh-home-paths", "@deepseek-ai/dsh-host-webserver", "@deepseek-ai/dsh-invariants", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-llm-pi-ai", "@deepseek-ai/dsh-fs", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-settings", "@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-web"];
    };
    readonly piAi: {
        readonly package: "@earendil-works/pi-ai";
        readonly version: "0.84.4";
    };
};
/** Evaluate a captured set of versions without touching the filesystem. */
export declare function evaluateCompatibility(input?: CompatibilityEvaluationInput): CompatibilityReport;
/** Alias for callers that prefer assessment terminology. */
export declare const assessCompatibility: typeof evaluateCompatibility;
/** Read installed package metadata and return only versions and statuses. */
export declare function detectCompatibility(options?: CompatibilityDetectionOptions): Promise<CompatibilityReport>;
