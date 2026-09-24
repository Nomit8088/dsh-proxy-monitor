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
/** Resolved geometry the rail positions against. */
export interface FrameInsets {
    /** Width in px of the left sidebar; 0 when there is no left column. */
    sidebar: number;
    /** Width in px reserved by an open right panel; 0 when it is closed. */
    rightbar: number;
    /**
     * Whether the right panel covers the whole frame. A fullscreen panel owns the
     * viewport, so the rail steps aside entirely rather than floating over it.
     */
    rightbarFullscreen: boolean;
}
/**
 * One raw geometry sample.
 *
 * `panelOpen` is the load-bearing field: the offset is driven by whether a panel
 * is actually open, never by a width that merely happens to be non-zero. That
 * direction of dependency is what makes the failure mode safe — if a measurement
 * is unavailable the rail falls back to the screen edge instead of being
 * stranded somewhere in the middle of the frame.
 */
export interface InsetsInput {
    /** The layout frame's own width in px; insets are clamped to it. */
    frameWidth: number;
    /** Left sidebar width, or undefined when the column cannot be found. */
    sidebarWidth: number | undefined;
    /** Whether a right panel reports itself open right now. */
    panelOpen: boolean;
    /** Width of the open right panel, or undefined when it cannot be measured. */
    panelWidth: number | undefined;
    /** Width of the right panel's grid track, or undefined when absent. */
    columnWidth: number | undefined;
    /** Whether that open panel is fullscreen. */
    rightbarFullscreen: boolean;
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
export declare function computeInsets(input: InsetsInput): FrameInsets;
/**
 * One measurement of the chat turn navigator against the rail.
 *
 * The navigator (`ui-chat`'s turn rail) is pinned near the right edge of the
 * conversation column with its tick marks right-aligned, so a rail hugging the
 * frame edge lands on top of it. The plugin cannot restyle another package's
 * element by class — the name is CSS-Modules-hashed — so instead of moving the
 * rail it makes room: the navigator is nudged left by exactly the overlap.
 *
 * ## Why the measurement feeds back safely
 *
 * The sample is taken *after* a shift may already have been applied, so the
 * shift currently in force is added back to recover the navigator's natural
 * position. That makes the arithmetic a fixed point rather than a running
 * total: feeding the result back in reproduces it unchanged, so re-measuring on
 * a resize settles instead of drifting the navigator leftward frame by frame.
 */
export interface TurnNavInput {
    /** The navigator's measured right edge, *including* any shift in force. */
    navRight: number;
    /** The navigator's measured width; 0 when it is not rendered. */
    navWidth: number;
    /** The shift this plugin currently has applied, in px. */
    appliedShift: number;
    /** The rail's own left edge, in the same coordinate space. */
    railLeft: number;
    /** Whether the rail is on screen at all. */
    railVisible: boolean;
    /**
     * Whether the rail is anchored to the right edge. Only then can it collide
     * with the navigator, which lives on the right. A left-anchored rail must
     * never shift it: `railLeft` would be near zero and the computed overlap
     * would be the whole viewport width.
     */
    railOnRight: boolean;
    /** Breathing room left between the navigator and the rail, in px. */
    gap: number;
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
export declare function computeTurnNavShift(input: TurnNavInput): number;
/**
 * Whether two readings agree, so a redundant observation does not re-render.
 * @param left - one reading.
 * @param right - the other reading.
 * @returns true when every field matches.
 */
export declare function sameInsets(left: FrameInsets, right: FrameInsets): boolean;
/** The insets used before the first measurement resolves. */
export declare const NO_INSETS: FrameInsets;
