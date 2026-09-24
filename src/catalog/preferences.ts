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
  id: string
  inputModalities?: readonly string[]
  supportsImages?: boolean
  input?: readonly string[]
}

/** Whether a catalog row infers image input. */
export function catalogRowSupportsImages(model: CatalogModelRef): boolean {
  if (model.supportsImages === true) return true
  if (Array.isArray(model.inputModalities) && model.inputModalities.includes('image')) return true
  return Array.isArray(model.input) && model.input.includes('image')
}

/** Models whose catalog entry already declares image input. */
export function defaultImageModelIdsFrom(models: readonly CatalogModelRef[]): string[] {
  return models.filter(catalogRowSupportsImages).map(model => model.id)
}

/**
 * Apply the user's image-support selection onto a catalog entry.
 *
 * Selected models declare `inputModalities: ["text", "image"]` so DSH will
 * not run `projectImagesForTextModel`.
 */
export function withUserImageSupport<T extends { id: string }>(
  model: T,
  imageIds: ReadonlySet<string> | readonly string[],
): T & { inputModalities: string[] } {
  const selected = imageIds instanceof Set ? imageIds : new Set(imageIds)
  const supportsImages = selected.has(model.id)
  return {
    ...model,
    inputModalities: supportsImages ? ['text', 'image'] : ['text'],
  }
}

/**
 * Merge enabled-id selection across a live catalog refresh.
 *
 * First fetch enables every live model. Later refreshes keep the user's
 * on/off choices and auto-enable newly discovered ids.
 */
export function mergeEnabledModelIds(
  current: { catalogModels?: readonly CatalogModelRef[]; enabledModelIds?: readonly string[] } | undefined,
  catalogModels: readonly CatalogModelRef[],
): string[] {
  const catalogIds = new Set(catalogModels.map(model => model.id))
  const previousIds = new Set((current?.catalogModels ?? []).map(model => model.id))
  const previousEnabled = Array.isArray(current?.enabledModelIds) ? [...current.enabledModelIds] : []
  const isFirstTime = previousIds.size === 0 && previousEnabled.length === 0
  if (isFirstTime) return catalogModels.map(model => model.id)
  const kept = previousEnabled.filter(id => catalogIds.has(id))
  const discovered = catalogModels.filter(model => !previousIds.has(model.id)).map(model => model.id)
  return [...new Set([...kept, ...discovered])]
}

/**
 * Merge image-support selection across a live catalog refresh.
 *
 * Existing ids keep the user's last choice; newly discovered models inherit
 * the inferred default from the live catalog.
 */
export function mergeImageModelIds(
  current: {
    catalogModels?: readonly CatalogModelRef[]
    imageModelIds?: readonly string[]
  } | undefined,
  catalogModels: readonly CatalogModelRef[],
  fallbackWhenMissing: readonly CatalogModelRef[] = [],
): string[] {
  const previousIds = new Set((current?.catalogModels ?? []).map(model => model.id))
  const previousImage = new Set(
    Array.isArray(current?.imageModelIds)
      ? current.imageModelIds
      : defaultImageModelIdsFrom(
          (current?.catalogModels ?? []).length > 0 ? current!.catalogModels! : fallbackWhenMissing,
        ),
  )
  return catalogModels
    .filter(model => {
      if (!previousIds.has(model.id)) return catalogRowSupportsImages(model)
      return previousImage.has(model.id)
    })
    .map(model => model.id)
}
