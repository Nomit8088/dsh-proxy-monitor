export interface AntigravityCredentials {
  access?: string;
  refresh?: string;
  expires?: number;
  email?: string;
  projectId?: string;
}

export declare class FileCredentialStore {
  constructor(filepath?: string);
  read(): Promise<AntigravityCredentials | undefined>;
  write(credentials: AntigravityCredentials): Promise<void>;
  delete(): Promise<void>;
  modify<T>(fn: (current: AntigravityCredentials | undefined) => Promise<T>): Promise<T>;
}

export declare function credentialPath(): string;

export interface WebLoginFlowResult {
  status: string;
  authUrl: string;
  startedAt: number;
}

export declare function beginWebLogin(store: FileCredentialStore): Promise<WebLoginFlowResult>;

export interface WebLoginStatus {
  status: 'idle' | 'pending' | 'complete' | 'error';
  startedAt?: number;
  completedAt?: number;
  email?: string;
  error?: string;
}

export declare function getWebLoginStatus(): WebLoginStatus;

export interface AntigravityModelSettings {
  enabledModelIds: string[];
  imageModelIds?: string[];
  catalogModels: Array<{
    id: string;
    name?: string;
    inputModalities?: string[];
    [key: string]: unknown;
  }>;
  updatedAt: number;
}

export declare class FileModelSettingsStore {
  constructor(filepath?: string);
  read(): Promise<AntigravityModelSettings>;
  setEnabledModelIds(ids: string[]): Promise<AntigravityModelSettings>;
  setImageModelIds(ids: string[]): Promise<AntigravityModelSettings>;
  setCatalogModels(
    catalogModels: AntigravityModelSettings['catalogModels'],
    options?: { enabledModelIds?: string[]; imageModelIds?: string[] },
  ): Promise<AntigravityModelSettings>;
  modify(
    fn: (current: AntigravityModelSettings) => AntigravityModelSettings | Promise<AntigravityModelSettings>,
  ): Promise<AntigravityModelSettings>;
}

export declare function modelSettingsPath(): string;

export declare class AntigravityAdapter {
  constructor(store: FileCredentialStore, modelSettings: FileModelSettingsStore);
}

export declare const PROVIDER: string;
export declare const PROVIDER_NAME: string;
export declare const name: string;
export declare const inject: readonly string[];
export declare function apply(
  ctx: unknown,
  options?: {
    store?: FileCredentialStore;
    modelSettings?: FileModelSettingsStore;
    registerAdapter?: boolean;
  },
): void;

export declare function parseCatalogModels(data: unknown): Array<{
  id: string;
  name: string;
  inputModalities: string[];
  [key: string]: unknown;
}>;
export declare function defaultImageModelIdsFrom(models: ReadonlyArray<{ id: string; inputModalities?: string[] }>): string[];
export declare function withUserImageSupport<T extends { id: string }>(
  model: T,
  imageIds: ReadonlySet<string> | readonly string[],
): T & { inputModalities: string[] };
export declare function mergeEnabledModelIds(
  current: { catalogModels?: Array<{ id: string }>; enabledModelIds?: string[] } | undefined,
  catalogModels: Array<{ id: string }>,
): string[];
export declare function mergeImageModelIds(
  current: { catalogModels?: Array<{ id: string }>; imageModelIds?: string[] } | undefined,
  catalogModels: Array<{ id: string; inputModalities?: string[] }>,
): string[];
export declare function imageModelIdsOf(settings: unknown): string[];
