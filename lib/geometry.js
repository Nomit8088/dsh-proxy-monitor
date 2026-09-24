/**
 * Pure geometry for the floating rail's edge offset.
 *
 * This module is deliberately free of DOM and React so the arithmetic that
 * decides where the rail sits can be unit-tested for real rather than through a
 * copied-out mirror. The browser half measures boxes and hands the raw numbers
 * here; everything that could be wrong about *placement* lives in
 * {@link computeInsets}.
 *
 * @module @dsh-external/dsh-proxy-monitor/geometry
 */
/** A finite, non-negative, rounded width from a possibly-unusable measurement. */
function width(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        return 0;
    return Math.round(value);
}
/**
 * Turn one measurement into the insets the rail positions against.
 *
 * ## Why the panel width wins over the animating track
 *
 * ui-sidebar-right positions its panel `absolute; right: 0` inside the grid
 * column and gives it an explicit width, while the column's own track animates
 * `0 -> width` during the open transition (`rightbarCol` is `overflow: visible`
 * precisely so the panel can hang over a zero-width track). The panel's rect
 * width is therefore constant for the whole transition, whereas the track
 * starts at 0.
 *
 * Preferring the track would make the offset oscillate: at the instant of
 * opening the track reads 0 (falling back to the wide panel), then reads a small
 * positive value on the next frame, so the rail would jitter outward and back.
 * Preferring the panel width instead makes the offset snap once to its final
 * value as the panel opens, and the panel then slides in to meet the rail — one
 * smooth motion, no oscillation.
 *
 * The track is kept only as a fallback, for a composition that opens a track
 * without a measurable panel.
 *
 * @param input - one geometry sample.
 * @returns the insets, clamped to the frame so the rail can never leave the viewport.
 */
export function computeInsets(input) {
    const frameWidth = width(input.frameWidth);
    if (input.rightbarFullscreen) {
        // Zero rather than the panel's width: the panel is `inset: 0` here, so its
        // width is the whole viewport. Reporting it as an offset would push the rail
        // off-screen for the frame before it hides.
        return { sidebar: 0, rightbar: 0, rightbarFullscreen: true };
    }
    const sidebar = Math.min(width(input.sidebarWidth), frameWidth);
    if (!input.panelOpen) {
        // Closed means closed: any residual width is a transition artifact or a
        // stale reading, and honouring it is exactly the bug this guards.
        return { sidebar, rightbar: 0, rightbarFullscreen: false };
    }
    const panel = width(input.panelWidth);
    const track = width(input.columnWidth);
    // Stable authority first; the animating track only covers a track with no
    // measurable panel.
    const rightbar = panel > 0 ? panel : track;
    return { sidebar, rightbar: Math.min(rightbar, frameWidth), rightbarFullscreen: false };
}
/**
 * How far left the turn navigator must move to sit clear of the rail.
 *
 * Returns 0 whenever there is nothing to clear — the rail is hidden, the
 * navigator is not rendered (it is `display: none` on a narrow viewport, which
 * measures as a zero-width rect), or the two do not overlap. A hidden navigator
 * must never be "shifted", and a zero result is also what returns it to its
 * natural place once the rail goes away.
 *
 * @param input - one measurement.
 * @returns the shift in px, never negative.
 */
export function computeTurnNavShift(input) {
    if (!input.railVisible)
        return 0;
    if (!input.railOnRight)
        return 0;
    if (!Number.isFinite(input.navWidth) || input.navWidth <= 0)
        return 0;
    if (!Number.isFinite(input.navRight) || !Number.isFinite(input.railLeft))
        return 0;
    // Undo the shift already in force to recover where the navigator would sit on
    // its own, then measure the overlap against the rail's left edge. The gap is
    // added to the overlap so the navigator stops short of the slab rather than
    // touching it.
    const naturalRight = input.navRight + input.appliedShift;
    const gap = Number.isFinite(input.gap) && input.gap > 0 ? input.gap : 0;
    const overlap = Math.round(naturalRight + gap - input.railLeft);
    return overlap > 0 ? overlap : 0;
}
/**
 * Whether two readings agree, so a redundant observation does not re-render.
 * @param left - one reading.
 * @param right - the other reading.
 * @returns true when every field matches.
 */
export function sameInsets(left, right) {
    return (left.sidebar === right.sidebar &&
        left.rightbar === right.rightbar &&
        left.rightbarFullscreen === right.rightbarFullscreen);
}
/** The insets used before the first measurement resolves. */
export const NO_INSETS = { sidebar: 0, rightbar: 0, rightbarFullscreen: false };
//# sourceMappingURL=geometry.js.map