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

import { useEffect, useState } from 'react'

import { computeInsets, sameInsets, NO_INSETS, type FrameInsets } from '../geometry.js'

export type { FrameInsets } from '../geometry.js'

/** The overlay layer carries this attribute; the frame is its parent. */
const OVERLAY_ATTRIBUTE = 'data-shell-overlay'

/** The right panel's grid column, present in every composition. */
const RIGHT_COLUMN_ATTRIBUTE = 'data-rightbar-col'

/** Present on the right panel exactly while it is expanded. */
const PANEL_OPEN_ATTRIBUTE = 'data-sidebar-right-open'

/**
 * The layout frame that owns the overlay layer this rail is mounted in.
 * @param host - the rail's outermost element.
 * @returns the frame element, or undefined when the composition is not mounted.
 */
function frameOf(host: HTMLElement): HTMLElement | undefined {
  const overlay = host.closest(`[${OVERLAY_ATTRIBUTE}]`) ?? host.parentElement
  return overlay?.parentElement ?? undefined
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
function sidebarColumnOf(frame: HTMLElement): HTMLElement | undefined {
  const first = frame.children[0]
  if (!(first instanceof HTMLElement) || first.hasAttribute(OVERLAY_ATTRIBUTE)) return undefined
  return first
}

/** Measure a box's border-box width, or undefined when the element is absent. */
function widthOf(element: Element | null | undefined): number | undefined {
  if (!(element instanceof HTMLElement)) return undefined
  const width = element.getBoundingClientRect().width
  return Number.isFinite(width) ? width : undefined
}

/**
 * Sample the frame's current geometry.
 * @param frame - the layout frame.
 * @returns the insets for this instant.
 */
function measure(frame: HTMLElement): FrameInsets {
  const panel = frame.querySelector(`[${PANEL_OPEN_ATTRIBUTE}]`)
  const column = frame.querySelector(`[${RIGHT_COLUMN_ATTRIBUTE}]`)

  return computeInsets({
    frameWidth: frame.getBoundingClientRect().width,
    sidebarWidth: widthOf(sidebarColumnOf(frame)),
    // The attribute is the authority on whether a panel is open; widths are only
    // consulted once that is established.
    panelOpen: panel !== null,
    // Width, not the left edge: the panel slides in via `translateX`, which moves
    // its rect without changing its width, so even a mid-slide read is settled.
    panelWidth: widthOf(panel),
    columnWidth: widthOf(column),
    // The frame carries this, set by the panel's owner.
    rightbarFullscreen: frame.hasAttribute('data-rightbar-fullscreen'),
  })
}

/**
 * Track the frame's column geometry while `active`.
 * @param host - the rail's outermost element, used to locate the frame.
 * @param active - whether the rail is mounted at all.
 * @returns the current insets.
 */
export function useFrameInsets(host: HTMLElement | null, active: boolean): FrameInsets {
  const [insets, setInsets] = useState<FrameInsets>(NO_INSETS)

  useEffect(() => {
    if (!active || host === null) return
    const frame = frameOf(host)
    if (frame === undefined) return

    // Mirror of the last published value: re-rendering on every observation
    // frame of a transition would be wasteful, and a state read would be stale
    // inside this closure.
    let current = NO_INSETS
    const read = (): void => {
      const next = measure(frame)
      if (sameInsets(current, next)) return
      current = next
      setInsets(next)
    }
    read()

    // Observes every frame of a column transition and once more at its end.
    const sizes = new ResizeObserver(read)
    const observeBoxes = (): void => {
      sizes.disconnect()
      sizes.observe(frame)
      const sidebar = sidebarColumnOf(frame)
      if (sidebar !== undefined) sizes.observe(sidebar)
      const column = frame.querySelector(`[${RIGHT_COLUMN_ATTRIBUTE}]`)
      if (column instanceof HTMLElement) sizes.observe(column)
      const panel = frame.querySelector(`[${PANEL_OPEN_ATTRIBUTE}]`)
      if (panel instanceof HTMLElement) sizes.observe(panel)
    }
    observeBoxes()

    // The panel mounts, unmounts, and gains/loses its open and fullscreen
    // attributes without necessarily resizing a box the observer already holds,
    // so each such change re-reads and re-binds the observers to whatever exists
    // now.
    const structure = new MutationObserver(() => {
      observeBoxes()
      read()
    })
    structure.observe(frame, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        PANEL_OPEN_ATTRIBUTE,
        'data-sidebar-right-panel',
        'data-rightbar-fullscreen',
        'data-rightbar-collapsed',
      ],
    })

    // A transition that ends with no size delta (skipped animation, or a
    // reduced-motion preference where the rule is `transition: none`) still gets
    // one final read.
    frame.addEventListener('transitionend', read)

    return () => {
      sizes.disconnect()
      structure.disconnect()
      frame.removeEventListener('transitionend', read)
    }
  }, [host, active])

  return insets
}
