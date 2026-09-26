/** OpenAI Codex adapter assembled from public dsh-llm-pi-ai extension points. */
import type { FetchFunction, Provider } from "@earendil-works/pi-ai";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import type { AttachmentStore, ImageAttachmentRef, ImageRequestTarget } from "@deepseek-ai/dsh-attachment";
import type { OpenAICodexCredentialStore } from "./store.js";
import type { ModelCatalogEntry, ResponseApiPreferences } from "./tool-policy.js";
import type { FastModeRegistry } from "./fast-mode.js";
import type { CodexLiveModelCatalog } from "./live-models.js";
/** Return a detached copy of the complete pi-ai Codex model catalog. */
export declare function openAICodexModelCatalog(live?: CodexLiveModelCatalog): readonly ModelCatalogEntry[];
/**
 * Overlay the user's image-support selection onto pi-ai `model.input`.
 *
 * DSH intercepts attachments when `inputModalities` is defined without
 * `"image"`; PiAiAdapter copies `model.input` into that field.
 */
export declare function withOpenAICodexImageModalities(provider: Provider, imageModelIds?: () => readonly string[] | undefined): Provider;
/** Provider idle ceiling used by the composite route. */
export declare const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Patch geometry used by Codex for `auto`/`high` prompt images. */
export declare const OPENAI_CODEX_IMAGE_PATCH_SIZE = 32;
/** Maximum patch count used by Codex for `auto`/`high` prompt images. */
export declare const OPENAI_CODEX_HIGH_DETAIL_MAX_PATCHES = 2500;
/** Maximum width or height accepted by Codex's `auto`/`high` preparation. */
export declare const OPENAI_CODEX_HIGH_DETAIL_MAX_DIMENSION = 2048;
/** Closest DSH pixel-budget projection of Codex's 2,500 32x32 patch limit. */
export declare const OPENAI_CODEX_REQUEST_IMAGE_PIXEL_BUDGET: number;
/**
 * Codex's high sanity guard for one prompt-image representation. DSH already
 * validates and normalizes attachments at much smaller ingestion limits, so
 * this deliberately avoids imposing a second lossy byte target on an image.
 */
export declare const OPENAI_CODEX_PROMPT_IMAGE_INPUT_GUARD_BYTES: number;
/**
 * Tighten DSH's area-only request projection until its resulting dimensions
 * also satisfy Codex's longest-edge and rounded patch-grid limits.
 */
export declare function openAICodexRequestImagePixelBudget(width: number, height: number, maxPixels: number): number;
/**
 * Tighten one request target until the resulting dimensions also satisfy
 * Codex's longest-edge and rounded patch-grid limits.
 *
 * The 0.1.7 attachment seam hands a provider an explicit width/height/byte
 * target — the pi-ai route derives it from that provider's pixel budget —
 * instead of the area-only `maxPixels` policy the earlier seam took. The
 * requested area is therefore recovered from the target box, run through the
 * same budget search, and the accepted projection is expressed back as an
 * explicit target. A target above the source keeps the source size, so this can
 * only ever shrink.
 *
 * @param ref - source attachment the request is being encoded from.
 * @param request - target the route asked for.
 * @returns the target with dimensions a high-detail Codex prompt image fits.
 */
export declare function openAICodexImageTarget(ref: ImageAttachmentRef, request: ImageRequestTarget): ImageRequestTarget;
/** Lift the pre-rc.7 pi-ai replay shape into the current envelope on read. */
export declare function migrateLegacyOpenAICodexReplayState(value: unknown): unknown;
/**
 * Codex traffic rides on chatgpt.com, which is frequently reached through a
 * local proxy tunnel that blips for tens of seconds at a time. The dsh
 * default stops after 2 retries and caps scheduled delays at 10 seconds, so
 * this provider retries longer and backs off further to ride out such a blip.
 */
export declare const OPENAI_CODEX_RETRY_POLICY: import("@deepseek-ai/dsh-llm").ResolvedRetryPolicy;
/** Add the request-scoped Fast Mode hint without changing other payload fields. */
export declare function withOpenAICodexFastMode(provider: Provider, fastMode: FastModeRegistry | undefined, fastModeDefault?: () => boolean): Provider;
/**
 * Create the Codex subscription adapter without requiring a dsh fork. The
 * public pi-ai adapter owns Harness message conversion, image attachment
 * resolution, streaming, and reasoning metadata. This plugin adds optional
 * Codex-native request state/compaction and supplies the provider OAuth token.
 */
export declare function createOpenAICodexAdapter(credentials: OpenAICodexCredentialStore, resolveAttachments: () => AttachmentStore | undefined, responsePreferences: () => ResponseApiPreferences, fastMode?: FastModeRegistry, visibleModelIds?: () => readonly string[], contextWindow?: () => number | null | undefined, overrideSparkContextWindow?: () => boolean | undefined, requestFetch?: FetchFunction, fastModeDefault?: () => boolean, imageModelIds?: () => readonly string[] | undefined, liveCatalog?: CodexLiveModelCatalog): PiAiAdapter;
