/**
 * Tests for the rail's edge-offset geometry.
 *
 * These import the COMPILED module (`lib/geometry.js`) rather than a
 * hand-copied mirror: the point of the module is that placement arithmetic can
 * be verified for real, so a mirror would test nothing but itself. Run the tsc
 * step first (scripts/build.mjs does).
 *
 * The regression these lock down: the rail must return to the screen edge when
 * a panel closes. An earlier implementation derived the offset from the frame's
 * computed `grid-template-columns`, which the frame *transitions* — so the read
 * landed mid-transition, the transition's end emitted no further mutation, and
 * the offset stuck at the panel's old width, stranding the rail mid-screen.
 *
 * Run with:  node scripts/test-frame.mjs
 */
import { strict as assert } from 'node:assert'

import { computeInsets, computeTurnNavShift, sameInsets, NO_INSETS } from '../lib/geometry.js'

const FRAME = 1400

/** A measurement with sensible defaults, so each case states only what it tests. */
function sample(overrides = {}) {
  return {
    frameWidth: FRAME,
    sidebarWidth: undefined,
    panelOpen: false,
    panelWidth: undefined,
    columnWidth: undefined,
    rightbarFullscreen: false,
    ...overrides,
  }
}

const cases = [
  {
    name: 'nothing open -> flush to both edges',
    input: sample(),
    want: { sidebar: 0, rightbar: 0 },
  },
  {
    name: 'left sidebar open, right closed',
    input: sample({ sidebarWidth: 280 }),
    want: { sidebar: 280, rightbar: 0 },
  },
  {
    name: 'right panel open on a track',
    input: sample({ panelOpen: true, panelWidth: 420, columnWidth: 420 }),
    want: { sidebar: 0, rightbar: 420 },
  },
  {
    name: 'both open',
    input: sample({ sidebarWidth: 280, panelOpen: true, panelWidth: 420, columnWidth: 420 }),
    want: { sidebar: 280, rightbar: 420 },
  },
  {
    name: 'panel floats over a zero-width track -> measured from the panel',
    input: sample({ panelOpen: true, panelWidth: 460, columnWidth: 0 }),
    want: { sidebar: 0, rightbar: 460 },
  },
  {
    name: 'opening instant (track still 0) -> panel width, so the offset does not oscillate',
    input: sample({ panelOpen: true, panelWidth: 460, columnWidth: 0 }),
    want: { sidebar: 0, rightbar: 460 },
  },
  {
    name: 'track without a measurable panel -> track is the fallback',
    input: sample({ panelOpen: true, columnWidth: 380 }),
    want: { sidebar: 0, rightbar: 380 },
  },
  {
    name: 'fullscreen panel reports no offset at all',
    input: sample({ panelOpen: true, panelWidth: FRAME, columnWidth: FRAME, rightbarFullscreen: true }),
    want: { sidebar: 0, rightbar: 0, rightbarFullscreen: true },
  },
]

let failed = 0
for (const testCase of cases) {
  const got = computeInsets(testCase.input)
  try {
    assert.equal(got.sidebar, testCase.want.sidebar, `${testCase.name}: sidebar`)
    assert.equal(got.rightbar, testCase.want.rightbar, `${testCase.name}: rightbar`)
    if (testCase.want.rightbarFullscreen !== undefined) {
      assert.equal(got.rightbarFullscreen, testCase.want.rightbarFullscreen, `${testCase.name}: fullscreen`)
    }
    console.log(`  ok   ${testCase.name} -> left=${String(got.sidebar)} right=${String(got.rightbar)}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL ${testCase.name}: ${error.message}`)
  }
}

/**
 * The bug this module exists to prevent. A stale, non-zero width arriving after
 * the panel closed must NOT become an offset — "closed" is decided by
 * `panelOpen`, never by a leftover measurement.
 */
const staleAfterClose = computeInsets(
  sample({ panelOpen: false, panelWidth: 420, columnWidth: 420 }),
)
assert.equal(staleAfterClose.rightbar, 0, 'a closed panel must not leave an offset behind')
assert.deepEqual(staleAfterClose, NO_INSETS)
console.log('  ok   regression: a stale width after close leaves the rail at the edge')

/** Change detection: identity comparison must be structural, not referential. */
assert.ok(sameInsets(computeInsets(sample()), computeInsets(sample())), 'equal readings compare equal')
assert.ok(
  !sameInsets(computeInsets(sample()), computeInsets(sample({ panelOpen: true, panelWidth: 420, columnWidth: 420 }))),
  'a changed reading compares unequal',
)
console.log('  ok   sameInsets detects change structurally')

/** Unusable measurements degrade to the edge instead of throwing or going NaN. */
for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -50, undefined]) {
  const got = computeInsets(sample({ sidebarWidth: bad, panelOpen: true, panelWidth: bad, columnWidth: bad }))
  assert.ok(Number.isFinite(got.sidebar) && got.sidebar >= 0, `sidebar must stay sane for ${String(bad)}`)
  assert.ok(Number.isFinite(got.rightbar) && got.rightbar >= 0, `rightbar must stay sane for ${String(bad)}`)
}
console.log('  ok   NaN / Infinity / negative / undefined widths degrade to 0')

/** An inset can never exceed the frame, or the rail leaves the viewport. */
const oversized = computeInsets(sample({ sidebarWidth: 9000, panelOpen: true, panelWidth: 9000, columnWidth: 9000 }))
assert.ok(oversized.sidebar <= FRAME && oversized.rightbar <= FRAME, 'insets are clamped to the frame')
console.log('  ok   oversized widths clamp to the frame width')

/** Change detection: identity comparison must be structural, not referential. */
assert.ok(sameInsets(computeInsets(sample()), computeInsets(sample())), 'equal readings compare equal')
assert.ok(
  !sameInsets(computeInsets(sample()), computeInsets(sample({ panelOpen: true, columnWidth: 420 }))),
  'a changed reading compares unequal',
)
console.log('  ok   sameInsets detects change structurally')

/**
 * The turn-navigator shift.
 *
 * DSH's own turn navigator is right-aligned near the same edge the rail hugs, so
 * the rail pushes it left by the overlap. The property that matters is that this
 * is a FIXED POINT: the measurement is taken after a shift may already be
 * applied, so feeding the result back must reproduce it exactly. If it did not,
 * every resize would push the navigator further left and it would creep off the
 * screen.
 */
const NAV_W = 28
const GAP = 10

/** One measurement, with the rail's left edge and the navigator's right edge. */
function navSample(overrides = {}) {
  return {
    navWidth: NAV_W,
    appliedShift: 0,
    railLeft: 0,
    railVisible: true,
    railOnRight: true,
    gap: GAP,
    navRight: 1400,
    ...overrides,
  }
}

/** The shift for a right-anchored rail 60px wide at the frame edge. */
const RAIL_LEFT = 1400 - 60
const firstShift = computeTurnNavShift(navSample({ railLeft: RAIL_LEFT }))
assert.equal(firstShift, 1400 + GAP - RAIL_LEFT, 'the shift is the overlap plus the gap')
console.log(`  ok   overlapping navigator shifts left by ${String(firstShift)}px`)

/**
 * The fixed point. After the shift is applied the navigator measures shifted, so
 * a fresh sample reports `navRight` reduced by it; recomputing must yield the
 * same number rather than growing.
 */
function settled(shift) {
  return computeTurnNavShift(
    navSample({
      railLeft: RAIL_LEFT,
      appliedShift: shift,
      // A shifted box really does measure shifted: this is the feedback path.
      navRight: 1400 - shift,
    }),
  )
}
assert.equal(settled(firstShift), firstShift, 'the shift is a fixed point when fed back')
assert.equal(settled(settled(firstShift)), firstShift, 'and again on the next observation')
console.log('  ok   regression: re-measuring reproduces the shift instead of creeping left')

/**
 * No overlap means no shift.
 *
 * This needs the navigator to be genuinely far from the frame edge, which really
 * happens: the navigator is positioned inside the conversation column, so on a
 * wide window it sits well left of the edge while the rail stays flush against
 * it. (Note that when both are at the edge a shift is ALWAYS due — that is not a
 * bug, it is the case this feature exists for.)
 */
assert.equal(
  computeTurnNavShift(navSample({ navRight: 1000, railLeft: 1200 })),
  0,
  'a navigator already clear of the rail is not moved',
)
console.log('  ok   a navigator clear of the rail is left where it is')

/**
 * A navigator that is not rendered measures as a zero-width rect (its slot is
 * `display: none` under a container query). Shifting that would apply a bogus
 * offset to an element that reappears later in the wrong place.
 */
assert.equal(
  computeTurnNavShift(navSample({ navRight: 0, navWidth: 0, railLeft: RAIL_LEFT })),
  0,
  'a hidden navigator is never shifted',
)
console.log('  ok   a hidden (zero-width) navigator is never shifted')

/** A left-anchored rail must never move a right-side navigator. */
assert.equal(
  computeTurnNavShift(navSample({ railLeft: 0, railOnRight: false, navRight: 1400 })),
  0,
  'a left-anchored rail does not shift a right-side navigator',
)
console.log('  ok   a left-anchored rail leaves the navigator alone')

/** A hidden rail releases the navigator back to its natural position. */
assert.equal(
  computeTurnNavShift(navSample({ railVisible: false, appliedShift: 40, navRight: 1360 })),
  0,
  'hiding the rail returns the navigator to its natural place',
)
console.log('  ok   hiding the rail releases the navigator')

/** Unusable numbers degrade to "do not touch the app". */
for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  assert.equal(
    computeTurnNavShift(navSample({ railLeft: bad, navRight: bad })),
    0,
    `a non-finite measurement must not move the app's element (${String(bad)})`,
  )
}
console.log('  ok   non-finite measurements leave the navigator untouched')

/** A negative gap or a missing one must not push the navigator the wrong way. */
assert.ok(
  computeTurnNavShift(navSample({ railLeft: RAIL_LEFT, gap: -500 })) >= 0,
  'a bogus gap cannot produce a negative shift',
)
console.log('  ok   a bogus gap cannot shift the navigator the wrong way')

if (failed > 0) {
  console.error(`\n${String(failed)} check(s) failed`)
  process.exit(1)
}
console.log('\nall rail-geometry checks passed')
