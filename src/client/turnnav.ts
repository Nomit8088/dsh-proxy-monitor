/**
 * Keeping DSH's own turn navigator clear of the rail (browser half).
 *
 * The conversation view owns a vertical turn-navigation rail — one tick per
 * turn, pinned near the right edge of the chat column with its marks
 * **right-aligned**. The quota rail is flush against the frame edge, so the two
 * want the same pixels and the navigator ends up underneath the slab.
 *
 * ## Why this plugin moves the navigator, not the other way round
 *
 * Pushing the quota rail inward would defeat its whole point: it is designed to
 * grow out of the screen edge, and a gap of one rail-width is exactly the
 * "floating card in the middle of the screen" look the design rejects. The
 * navigator, by contrast, is a navigation affordance with slack to its left, so
 * nudging it left by the overlap is invisible apart from the benefit.
 *
 * ## Why the element is found structurally
 *
 * The navigator's class name is CSS-Modules-hashed (`eGxaPq_frame`) and changes
 * whenever that package is rebuilt, so selecting on it would break silently on
 * a harness upgrade. Its *aria-label* is localised. What is stable is its
 * structure: a `nav` that is absolutely positioned inside a zero-height sticky
 * slot. That is what {@link findTurnNavigator} matches, and it matches nothing
 * else in a DSH frame.
 *
 * ## Why `margin-right`
 *
 * The navigator's own placement is `right: calc(...)` from that package's
 * stylesheet, which this plugin must not clobber. For an absolutely positioned
 * box with `right` and a `width` but no `left`, the used `left` is
 * `cbWidth - right - width - margin-right`: a `margin-right` shifts the box left
 * without touching the app's own value, and removing the property restores it
 * exactly.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/turnnav
 */

import { useLayoutEffect, useRef } from 'react'

import { computeTurnNavShift } from '../geometry.js'

/** The overlay layer carries this attribute; the layout frame is its parent. */
const OVERLAY_ATTRIBUTE = 'data-shell-overlay'

/**
 * Breathing room left between the navigator's marks and the slab. Enough that
 * the two read as neighbours rather than as one crowded object.
 */
const CLEARANCE_GAP_PX = 10

/**
 * The conversation view's turn navigator, if it is mounted.
 *
 * Matched structurally rather than by class or label: an absolutely positioned
 * `nav` whose parent is a zero-height sticky slot. A `display: none` slot (the
 * narrow-viewport rule) still matches here, and is then filtered out by the
 * zero-width check in the geometry — a hidden navigator must not be shifted.
 *
 * @param frame - the layout frame to search.
 * @returns the navigator element, or undefined when the chat view is not shown.
 */
function findTurnNavigator(frame: HTMLElement): HTMLElement | undefined {
  for (const candidate of frame.querySelectorAll('nav')) {
    if (!(candidate instanceof HTMLElement)) continue
    if (getComputedStyle(candidate).position !== 'absolute') continue
    const slot = candidate.parentElement
    if (slot === null) continue
    if (getComputedStyle(slot).position !== 'sticky') continue
    // The slot is a zero-height sticky marker: it contributes no layout of its
    // own, which is precisely why the navigator hangs out of it.
    if (slot.getBoundingClientRect().height > 0.5) continue
    return candidate
  }
  return undefined
}

/**
 * Take the shift off one navigator element, restoring its own styling.
 * @param element - the element to release, if any.
 */
function release(element: HTMLElement | null): void {
  element?.style.removeProperty('margin-right')
}

/**
 * Hold the turn navigator clear of the rail for as long as it is mounted.
 *
 * @param slab - the rail's painted slab, whose left edge is the boundary to
 *   clear. `null` until the rail has mounted.
 * @param active - whether the rail is on screen at all.
 * @param enabled - the user's setting; when false this never touches the app.
 * @param anchor - the edge the rail is docked to. Only a right-anchored rail can
 *   collide with the navigator; a left-anchored one must leave it alone, so the
 *   anchor is part of the effect's identity and changes it re-measures.
 * @param revision - any value that changes when the rail's footprint moves
 *   (the frame insets). The navigator's position relative to the frame changes
 *   with the sidebars, and neither box's *size* necessarily changes then, so a
 *   resize observer alone would not see it.
 */
export function useTurnNavigatorClearance(
  slab: HTMLElement | null,
  active: boolean,
  enabled: boolean,
  anchor: 'right' | 'left',
  revision: string,
): void {
  /** The shift currently applied, mirrored for the next measurement. */
  const appliedRef = useRef(0)
  /** The element the shift is applied to, so it can be restored. */
  const styledRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!active || !enabled || anchor !== 'right' || slab === null) return
    const owner = slab.closest(`[${OVERLAY_ATTRIBUTE}]`)
    const found = owner?.parentElement
    // `?.` yields `undefined` for a missing owner but `null` for a detached
    // parent, so both are rejected here.
    if (found === undefined || found === null) return
    // Re-bound to an explicitly non-optional const: `bind` below is a hoisted
    // function declaration, and TypeScript discards a narrowing inside one
    // because it could in principle run before the check.
    const frame: HTMLElement = found

    /** Measure and apply; never re-renders, so it cannot feed itself. */
    const apply = (): void => {
      const nav = styledRef.current
      if (nav === null) return
      const navRect = nav.getBoundingClientRect()
      const slabRect = slab.getBoundingClientRect()
      const next = computeTurnNavShift({
        navRight: navRect.right,
        navWidth: navRect.width,
        // The measurement is taken *after* a shift may already be applied, so
        // the shift in force is added back to recover the natural position.
        appliedShift: appliedRef.current,
        railLeft: slabRect.left,
        railVisible: slabRect.width > 0,
        railOnRight: anchor === 'right',
        gap: CLEARANCE_GAP_PX,
      })
      if (next === appliedRef.current) return
      appliedRef.current = next
      if (next === 0) nav.style.removeProperty('margin-right')
      else nav.style.setProperty('margin-right', `${String(next)}px`)
    }

    const sizes = new ResizeObserver(() => {
      bind()
    })

    /**
     * Re-resolve the navigator, then measure. The element is replaced whenever
     * the chat view remounts (a session switch), and a replacement arrives
     * without the shift this hook had applied.
     */
    function bind(): void {
      const found = findTurnNavigator(frame) ?? null
      if (found !== styledRef.current) {
        release(styledRef.current)
        styledRef.current = found
        appliedRef.current = 0
      }
      // Re-bound wholesale rather than added to: a replaced navigator would
      // otherwise leave its predecessor observed forever.
      sizes.disconnect()
      sizes.observe(frame)
      if (found !== null) sizes.observe(found)
      apply()
    }
    bind()

    // The navigator mounts and unmounts with the chat view, and is hidden by a
    // container query on a narrow viewport; both are structural changes that no
    // size observer on the frame would notice.
    const structure = new MutationObserver(() => {
      bind()
    })
    structure.observe(frame, { childList: true, subtree: true })

    return () => {
      structure.disconnect()
      sizes.disconnect()
      release(styledRef.current)
      styledRef.current = null
      appliedRef.current = 0
    }
  }, [slab, active, enabled, anchor, revision])
}
