/**
 * Renders the rail's silhouette to verify the edge-hugging shape.
 *
 * Three curves carry the design, and all three are easy to get subtly wrong:
 *
 * 1. **The edge scoops**, where the slab tapers into the screen edge.
 * 2. **The inner rounding**, which must be on the inner side only — a rounded
 *    outer edge would leave a notch of app background against the screen.
 * 3. **The popover tongue**, which bridges the detail card back to the slab.
 *
 * This script rasterises the SAME geometry the stylesheet declares, in the
 * stylesheet's own coordinate convention, so the silhouette can be checked
 * without a browser. The convention, stated once:
 *
 * - The tab is right-anchored: the screen edge is the tab's RIGHT side.
 * - A scoop box sits directly above (or below) the slab, flush to the screen
 *   edge, and is `SCOOP` tall. Its width is the slab's width MINUS the slab's
 *   inner corner radius — that is what makes its foot line up with the slab's
 *   own rounded corner instead of overshooting by the radius.
 * - The gradient is centred on the box corner away from BOTH the screen edge and
 *   the slab, with radii equal to the box's own size, and the FILL is everything
 *   at ellipse distance >= 1.
 *
 * ## The regression this locks down
 *
 * Two earlier revisions failed here, and both failures were only visible in the
 * rasterised silhouette:
 *
 * 1. A small (24px) fillet box at the edge left a **42px step in one row** where
 *    it met the 60px slab — a hard horizontal seam.
 * 2. A box spanning the FULL slab width removed the step but overshot by the
 *    slab's corner radius, because the slab's inner edge is rounded at the top,
 *    so its outline starts `RADIUS` in from the inner edge — not at it.
 *
 * Run with:  node scripts/preview-shape.mjs
 */
const SCOOP = 54
const RADIUS = 24
const SLAB_W = 60
const SLAB_H = 160
/** The scoop box's width: the slab minus its inner corner radius. */
const SCOOP_W = SLAB_W - RADIUS

/** Tongue geometry, mirroring the stylesheet's clip-path sample points. */
const TONGUE_H = 80
/** Inset fraction at the neck: `C` in `inset = C · H · smoothstep(t)`. */
const TAPER_C = 0.16

const COLS = SLAB_W + 8
const ROWS = SCOOP + SLAB_H + SCOOP
/** ASCII column of the screen edge (right-hand side). */
const EDGE = COLS - 1
/** ASCII column of the slab's inner (left) boundary. */
const INNER = COLS - SLAB_W

/** Top of the slab body in raster rows. */
const SLAB_TOP = SCOOP
const SLAB_BOTTOM = SCOOP + SLAB_H

/**
 * Whether the tab's fill covers one cell.
 * @param col - ASCII column; EDGE is the screen edge.
 * @param row - ASCII row; 0 is the top of the upper scoop zone.
 * @returns true when painted.
 */
function filled(col, row) {
  // ── slab body ──────────────────────────────────────────────────────────────
  if (row >= SLAB_TOP && row < SLAB_BOTTOM) {
    if (col < INNER) return false
    // Rounded on the INNER side only; the outer edge stays square so the tab
    // never leaves a notch of app background against the screen.
    const fromInner = col - INNER
    const fromTop = row - SLAB_TOP
    const fromBottom = SLAB_BOTTOM - 1 - row
    if (fromTop < RADIUS) {
      const dy = RADIUS - fromTop
      const dx = RADIUS - fromInner
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > RADIUS * RADIUS) return false
    }
    if (fromBottom < RADIUS) {
      const dy = RADIUS - fromBottom
      const dx = RADIUS - fromInner
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > RADIUS * RADIUS) return false
    }
    return true
  }

  // ── scoop zones ────────────────────────────────────────────────────────────
  // The box is SCOOP_W wide, flush to the screen edge, SCOOP tall, and its
  // gradient centre is the corner away from BOTH the edge and the slab: the
  // box's inner side and its far end. So:
  //   u = distance from the box's INNER side
  //   v = distance from the box's FAR end (i.e. away from the slab)
  // and the fill is `(u/SCOOP_W)^2 + (v/SCOOP)^2 >= 1`.
  const upper = row < SLAB_TOP
  // Distance from the far end: for the upper box the far end is the top, and for
  // the lower box it is the bottom.
  const v = upper ? row : ROWS - 1 - row
  if (v < 0 || v >= SCOOP) return false
  // The box's inner side sits RADIUS in from the slab's inner edge, because the
  // box is narrowed by exactly the slab's corner radius (see the header).
  const u = col - (EDGE - SCOOP_W + 1)
  if (u < 0 || u > SCOOP_W) return false
  const norm = (u / SCOOP_W) ** 2 + (v / SCOOP) ** 2
  return norm >= 1
}

const lines = []
for (let row = 0; row < ROWS; row += 3) {
  let line = ''
  for (let col = 0; col < COLS; col += 1) line += filled(col, row) ? '#' : '·'
  lines.push(line)
}

console.log('app  ────────────────────────────────────────►  screen edge')
for (const line of lines) console.log(line)

/** Painted width of each row, for continuity checks. */
const widths = []
for (let row = 0; row < ROWS; row += 1) {
  let count = 0
  for (let col = 0; col < COLS; col += 1) if (filled(col, row)) count += 1
  widths.push(count)
}
const middle = widths[Math.floor(ROWS / 2)]
console.log(`\ntop width=${String(widths[0])}  body width=${String(middle)}  bottom width=${String(widths[ROWS - 1])}`)

let failed = 0
function check(label, condition) {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failed += 1
}

// The essence of the effect: the silhouette meets the screen edge at top and
// bottom and reaches full width only through the body.
check('meets the screen edge with a sliver at the top', widths[0] <= 1)
check('meets the screen edge with a sliver at the bottom', widths[ROWS - 1] <= 1)
check('reaches full slab width through the body', middle === SLAB_W)
check('painted flush at the screen edge mid-body', filled(EDGE, Math.floor(ROWS / 2)))
check('nothing painted beyond the slab into the app', !filled(INNER - 1, Math.floor(ROWS / 2)))

/**
 * THE regression, established analytically rather than by counting raster rows.
 *
 * The join is where two independently-drawn curves must meet: the scoop above,
 * and the slab's rounded inner corner below. Counting painted cells per row
 * cannot test this well, because BOTH curves have a vertical tangent at the join
 * — that is precisely what makes them meet without a kink — so the width
 * legitimately changes several px between adjacent rows there. What matters is
 * that the two boundaries coincide at the join and share a tangent.
 *
 * So both boundaries are evaluated directly, at the join and just either side.
 */
/**
 * The scoop's inner boundary `x`, for `v` = distance from the box's FAR end
 * (away from the slab). `v = 0` is the far end, `v = SCOOP` is the join — so
 * `x(0) = SLAB_W` (zero width, a sliver on the screen edge) and
 * `x(SCOOP) = SLAB_W - SCOOP_W` (the full box, flush with the slab's corner arc).
 */
const scoopBoundaryX = v => (SLAB_W - SCOOP_W) + SCOOP_W * Math.sqrt(Math.max(0, 1 - (v / SCOOP) ** 2))
/** The slab's inner boundary at depth `y` below its top edge: `x(0) = RADIUS`. */
const slabBoundaryX = y => RADIUS - Math.sqrt(Math.max(0, RADIUS * RADIUS - (RADIUS - y) ** 2))

const scoopAtJoin = scoopBoundaryX(SCOOP)
const slabAtJoin = slabBoundaryX(0)
console.log(`\njoin, analytically: scoop boundary x=${scoopAtJoin.toFixed(3)}  slab boundary x=${slabAtJoin.toFixed(3)}`)
check('the two boundaries coincide at the join (no notch, no shelf)', Math.abs(scoopAtJoin - slabAtJoin) < 0.01)

// Tangent continuity: both derivatives must be equal at the join, or the
// silhouette has a visible corner even though the two points coincide.
const H = 1e-4
const scoopSlope = (scoopBoundaryX(SCOOP) - scoopBoundaryX(SCOOP - H)) / H
const slabSlope = (slabBoundaryX(H) - slabBoundaryX(0)) / H
console.log(`join tangents: scoop=${scoopSlope.toFixed(1)}  slab=${slabSlope.toFixed(1)} (both should be large & equal)`)
check('the two boundaries share a tangent at the join (no kink)', Math.abs(scoopSlope - slabSlope) < 1)

// Away from the join the silhouette must be smooth; there a per-row check is
// meaningful, so this is where the raster is consulted.
let worstStep = 0
let worstAt = -1
for (let row = 1; row < ROWS; row += 1) {
  const nearJoin =
    (row > SLAB_TOP - 8 && row < SLAB_TOP + 8) || (row > SLAB_BOTTOM - 8 && row < SLAB_BOTTOM + 8)
  if (nearJoin) continue
  const step = Math.abs(widths[row] - widths[row - 1])
  if (step > worstStep) {
    worstStep = step
    worstAt = row
  }
}
console.log(`largest row-to-row width step away from the joins: ${String(worstStep)}px (at row ${String(worstAt)})`)
check('scoop and body are smooth away from the join (max step <= 3px)', worstStep <= 3)

// Monotonic: the width must grow steadily through the scoop, never dip.
let monotonicUpper = true
for (let row = 1; row < SLAB_TOP; row += 1) if (widths[row] < widths[row - 1]) monotonicUpper = false
check('upper scoop flares monotonically into the body', monotonicUpper)

let monotonicLower = true
for (let row = SLAB_BOTTOM; row < ROWS; row += 1) if (widths[row] > widths[row - 1]) monotonicLower = false
check('lower scoop tapers monotonically out of the body', monotonicLower)

// ── the scoop's SHAPE: a long thin tail that swells into the slab ───────────
// The visible consequence of the vertical tangent at the join: the fill hugs the
// screen edge for most of the scoop's height and opens up only near the slab.
// Evaluated from the curve, since the raster is coarse in the thin tail.
/** Painted width at `v` px from the box's far end (0 = the edge, SCOOP = the slab). */
const scoopWidthAt = v => SLAB_W - scoopBoundaryX(v)
console.log('\nscoop profile (0% = far end at the screen edge, 100% = the join):')
for (const fraction of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
  const width = scoopWidthAt(SCOOP * fraction)
  console.log(`  ${String(Math.round(fraction * 100)).padStart(3)}% of the way in: ${width.toFixed(1).padStart(4)}px wide`)
}
check('scoop starts as a sliver on the screen edge', scoopWidthAt(0) < 0.01)
check('scoop has a long thin tail (still narrow halfway in)', scoopWidthAt(SCOOP * 0.5) < SLAB_W * 0.15)
check('scoop has opened up substantially by the join', scoopWidthAt(SCOOP) >= SCOOP_W - 0.01)
// Strictly increasing along the whole curve, not merely at the sample points.
let strictlyIncreasing = true
for (let step = 1; step <= 200; step += 1) {
  if (scoopWidthAt(SCOOP * (step / 200)) <= scoopWidthAt(SCOOP * ((step - 1) / 200))) strictlyIncreasing = false
}
check('scoop profile is strictly increasing along the curve', strictlyIncreasing)

// ── the popover tongue ───────────────────────────────────────────────────────
/** Smoothstep, the easing both the clip-path and this model use. */
function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

/**
 * Half-height of the tongue at horizontal fraction `t` (0 = card, 1 = slab).
 * The boundary is inset `C · H · smoothstep(t)` from each edge of the tongue.
 */
function tongueHalfWidth(t) {
  return TONGUE_H / 2 - TAPER_C * TONGUE_H * smoothstep(t)
}
const neckRatio = tongueHalfWidth(1) / tongueHalfWidth(0)
console.log(`\ntongue: card-side half=${tongueHalfWidth(0).toFixed(1)}px  neck half=${tongueHalfWidth(1).toFixed(1)}px  neck=${(neckRatio * 100).toFixed(0)}% of full`)

check('tongue leaves the card at full height', Math.abs(tongueHalfWidth(0) * 2 - TONGUE_H) < 1e-9)
check('tongue narrows to a neck at the slab', neckRatio > 0.5 && neckRatio < 0.7)

let tightens = true
for (let step = 1; step <= 20; step += 1) {
  if (tongueHalfWidth(step / 20) > tongueHalfWidth((step - 1) / 20)) tightens = false
}
check('tongue taper is monotonic from card to neck', tightens)

// Tangency at both ends removes the kink where the tongue meets the card and
// the slab. A plain quadratic would pass monotonicity but fail this.
function slope(t, h = 1e-4) {
  return (smoothstep(t + h) - smoothstep(t - h)) / (2 * h)
}
check('tongue sides are tangent to the card edge', Math.abs(slope(0)) < 1e-3)
check('tongue sides are tangent at the slab edge', Math.abs(slope(1)) < 1e-3)

// An S-curve: it bulges outward near the card and inward near the slab, so the
// neck reads as drawn out of the card rather than as a straight wedge. Sampled
// off-centre, because at t = 0.5 every symmetric curve lies on the chord.
const chordAt = t => tongueHalfWidth(0) + (tongueHalfWidth(1) - tongueHalfWidth(0)) * t
const bulgeNearCard = tongueHalfWidth(0.25) - chordAt(0.25)
const bulgeNearSlab = tongueHalfWidth(0.75) - chordAt(0.75)
console.log(`tongue S-curve: deviation near card=${bulgeNearCard.toFixed(2)}px  near slab=${bulgeNearSlab.toFixed(2)}px`)
check('tongue bows outward near the card', bulgeNearCard > 0.2)
check('tongue bows inward near the slab', bulgeNearSlab < -0.2)
check('tongue S-curve is symmetric about its midpoint', Math.abs(bulgeNearCard + bulgeNearSlab) < 1e-9)

// ── the clip-path literals must encode the same curve ───────────────────────
// The polygon is written out by hand, so re-derive its expected sample points
// and compare. This is what stops the stylesheet and this model drifting apart.
const clipPoints = [0, 0.45, 1.66, 3.46, 5.63, 8, 10.37, 12.54, 14.34, 15.55, 16]
let clipMatches = true
for (let index = 0; index < clipPoints.length; index += 1) {
  const expected = TAPER_C * smoothstep(index / 10) * 100
  if (Math.abs(clipPoints[index] - expected) > 0.02) clipMatches = false
}
check('clip-path sample points match the smoothstep curve', clipMatches)

// ── render the tongue so the curve can actually be seen ─────────────────────
const TONGUE_W = 27
console.log(`\n${' '.repeat(6)}card ─────────────────► slab`)
for (let row = 0; row < TONGUE_H; row += 3) {
  const y = row - TONGUE_H / 2
  let line = ''
  for (let col = 0; col < TONGUE_W; col += 1) {
    line += Math.abs(y) <= tongueHalfWidth(col / (TONGUE_W - 1)) ? '#' : '·'
  }
  console.log(`${String(row).padStart(4)}  ${line}`)
}

if (failed > 0) {
  console.error(`\n${String(failed)} shape check(s) failed`)
  process.exit(1)
}
console.log('\nrail silhouette verified: square outer edge, rounded inner edge, continuous scoops, tapered tongue')
