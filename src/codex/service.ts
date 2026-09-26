/** Shared host service consumed by optional OpenAI Codex front-door adapters. */

import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { Context } from "@deepseek-ai/cordis";
import {
  loginOpenAICodex,
  logoutOpenAICodex,
  openAICodexAuthStatus,
} from "./auth.js";
import type { OpenAICodexAuthStatus } from "./auth.js";
import { OpenAICodexCredentialStore } from "./store.js";
import { OpenAICodexProxyTransport } from "./proxy.js";
import type { ProxyPreferences } from "./proxy.js";
import { ImageToolPolicy } from "./tool-policy.js";
import type {
  ContextWindowPreferences,
  FastModePreferences,
  ImageToolPreferences,
  ModelCatalogEntry,
  ModelCatalogSettings,
  ResponseApiPreferences,
} from "./tool-policy.js";
import { readOpenAICodexRateLimits } from "./usage.js";
import type { OpenAICodexUsage } from "./usage.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Provider-owned account and preference service for optional front doors. */
    openAICodex: OpenAICodexService;
  }
}

/** Initial settings contributed by the bundle configuration. */
export interface OpenAICodexServiceOptions
  extends
    ImageToolPreferences,
    ResponseApiPreferences,
    ContextWindowPreferences,
    FastModePreferences,
    ProxyPreferences {
  models?: string[];
  modelCatalog: readonly ModelCatalogEntry[];
}

/**
 * One provider-owned host service shared by Web routes and terminal adapters.
 * Credentials and live policy stay singletons even when several front doors are mounted.
 */
export class OpenAICodexService {
  readonly credentials = new OpenAICodexCredentialStore();
  readonly policy: ImageToolPolicy;
  readonly proxy: OpenAICodexProxyTransport;
  private readonly stopProxyWatch: () => void;

  constructor(options: OpenAICodexServiceOptions) {
    this.policy = new ImageToolPolicy(options, options.modelCatalog);
    this.proxy = new OpenAICodexProxyTransport(() =>
      this.policy.proxySnapshot()
    );
    void this.proxy.apply().catch((error: unknown) => {
      process.stderr.write(
        `[dsh-codex] failed to apply proxy settings: ${error instanceof Error ? error.message : String(error)}\n`
      );
    });
    this.stopProxyWatch = this.policy.watchProxyPreferences(() => {
      void this.proxy.apply().catch((error: unknown) => {
        process.stderr.write(
          `[dsh-codex] failed to apply proxy settings: ${error instanceof Error ? error.message : String(error)}\n`
        );
      });
    });
  }

  /**
   * Adopt the durable preference document.
   *
   * The document is this provider's own file under the Harness home; the
   * settings seam owns the provider's *configuration* (and no longer exposes
   * per-plugin namespaces anyway), while these values are written by the
   * provider's own routes.
   */
  attachSettings(ctx: Context): void {
    this.policy.attach(ctx);
  }

  /** Start the provider-native OAuth lifecycle. */
  async login(interaction: AuthInteraction): Promise<void> {
    await this.proxy.apply();
    return await loginOpenAICodex(interaction, this.credentials);
  }

  /** Remove this plugin's credential without touching Codex CLI/Desktop. */
  logout(): Promise<void> {
    return logoutOpenAICodex(this.credentials);
  }

  /** Read non-secret authentication metadata. */
  authStatus(): Promise<OpenAICodexAuthStatus> {
    return openAICodexAuthStatus(this.credentials);
  }

  /** Read current subscription limits without issuing a model request. */
  usage(): Promise<OpenAICodexUsage> {
    return readOpenAICodexRateLimits(this.credentials, this.proxy.fetch);
  }

  imagePreferences(): ImageToolPreferences {
    return this.policy.snapshot();
  }

  updateImagePreferences(
    patch: Partial<ImageToolPreferences>
  ): Promise<ImageToolPreferences> {
    return this.policy.update(patch);
  }

  responsePreferences(): ResponseApiPreferences {
    return this.policy.responseApiSnapshot();
  }

  updateResponsePreferences(
    patch: Partial<ResponseApiPreferences>
  ): Promise<ResponseApiPreferences> {
    return this.policy.updateResponseApi(patch);
  }

  contextWindowPreferences(): ContextWindowPreferences {
    return this.policy.contextWindowSnapshot();
  }

  updateContextWindowPreferences(
    patch: Partial<ContextWindowPreferences>
  ): Promise<ContextWindowPreferences> {
    return this.policy.updateContextWindow(patch);
  }

  fastModePreferences(): FastModePreferences {
    return this.policy.fastModeSnapshot();
  }

  updateFastModePreferences(
    patch: Partial<FastModePreferences>
  ): Promise<FastModePreferences> {
    return this.policy.updateFastMode(patch);
  }

  modelCatalogSettings(): ModelCatalogSettings {
    return this.policy.modelCatalogSnapshot();
  }

  proxyPreferences(): ProxyPreferences {
    return this.policy.proxySnapshot();
  }

  async updateProxyPreferences(
    patch: Partial<ProxyPreferences>
  ): Promise<ProxyPreferences> {
    const preferences = await this.policy.updateProxy(patch);
    await this.proxy.apply();
    return preferences;
  }

  async dispose(): Promise<void> {
    this.stopProxyWatch();
    await this.proxy.dispose();
  }
}
