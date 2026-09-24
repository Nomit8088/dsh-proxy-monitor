/**
 * Shared enable / image-support merge for live model catalogs.
 *
 * DSH intercepts attached images when `inputModalities` is defined and does
 * not include `"image"`. Selected models must declare image input.
 *
 * @module @dsh-external/dsh-proxy-monitor/catalog/preferences
 */
/** One catalog row the merge helpers understand. */
export interface CatalogModelRef {
    id: string;
    inputModalities?: readonly string[];
    supportsImages?: boolean;
    input?: readonly string[];
}
/** Whether a catalog row infers image input. */
export declare function catalogRowSupportsImages(model: CatalogModelRef): boolean;
/** Models whose catalog entry already declares image input. */
export declare function defaultImageModelIdsFrom(models: readonly CatalogModelRef[]): string[];
/**
 * Apply the user's image-support selection onto a catalog entry.
 *
 * Selected models declare `inputModalities: ["text", "image"]` so DSH will
 * not run `projectImagesForTextModel`.
 */
export declare function withUserImageSupport<T extends {
    id: string;
}>(model: T, imageIds: ReadonlySet<string> | readonly string[]): T & {
    inputModalities: string[];
};
/**
 * Merge enabled-id selection across a live catalog refresh.
 *
 * First fetch enables every live model. Later refreshes keep the user's
 * on/off choices and auto-enable newly discovered ids.
 */
export declare function mergeEnabledModelIds(current: {
    catalogModels?: readonly CatalogModelRef[];
    enabledModelIds?: readonly string[];
} | undefined, catalogModels: readonly CatalogModelRef[]): string[];
/**
 * Merge image-support selection across a live catalog refresh.
 *
 * Existing ids keep the user's last choice; newly discovered models inherit
 * the inferred default from the live catalog.
 */
export declare function mergeImageModelIds(current: {
    catalogModels?: readonly CatalogModelRef[];
    imageModelIds?: readonly string[];
} | undefined, catalogModels: readonly CatalogModelRef[], fallbackWhenMissing?: readonly CatalogModelRef[]): string[];
