/**
 * Grok model enable / image-support preferences persisted under DSH home.
 *
 * @module @dsh-external/dsh-proxy-monitor/grok/model-settings
 */
import { type CatalogModelRef } from '../catalog/preferences.js';
/** One row stored from the last live listing. */
export interface GrokCatalogModel extends CatalogModelRef {
    id: string;
    name: string;
}
/** On-disk Grok catalog preferences. */
export interface GrokModelPreferences {
    enabledModelIds: string[];
    imageModelIds: string[];
    catalogModels: GrokCatalogModel[];
    updatedAt: number;
}
/** File-backed Grok model preferences. */
export declare class GrokModelSettingsStore {
    readonly path: string;
    private cache;
    private chain;
    constructor(file?: string);
    /** Last known preferences; empty until the first `read`. */
    snapshot(): GrokModelPreferences;
    read(): Promise<GrokModelPreferences>;
    write(settings: GrokModelPreferences): Promise<GrokModelPreferences>;
    modify(fn: (current: GrokModelPreferences) => GrokModelPreferences | Promise<GrokModelPreferences>): Promise<GrokModelPreferences>;
    /** Merge a live listing into stored enable / image selections. */
    adoptLiveCatalog(catalogModels: GrokCatalogModel[]): Promise<GrokModelPreferences>;
}
