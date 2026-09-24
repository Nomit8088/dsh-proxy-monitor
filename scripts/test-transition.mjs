/**
 * Reproduces the "rail stranded mid-screen" bug against the real module.
 *
 * The original defect was a *timing* one: the offset was derived from a
 * geometry read taken in response to a style mutation, but the layout frame
 * animates `grid-template-columns`, so that read landed mid-transition and the
 * transition's end emitted no further mutation — the mid-transition value stuck
 * permanently, leaving the rail parked away from the screen edge.
 *
 * A pure-function test cannot catch that, so this harness drives the geometry
 * module through the real event order with a fake DOM:
 *
 *   1. measure the closed frame                     -> expect 0
 *   2. apply the open mutation, measure immediately -> the panel width
 *   3. run the transition frames, measure each      -> identical every frame
 *   4. fire the final observation at settle         -> the same value (no jitter)
 *   5. close the panel, measure immediately         -> expect 0  (the bug)
 *   6. fire the final observation at settle         -> expect 0
 *
 * Step 5 is the original regression: under the old implementation it kept
 * reading the *open* width forever. Step 3 is the second one this harness found
 * — deriving the offset from the animating track made it oscillate, because the
 * track is 0 at the instant of opening. Both are now locked down.
 *
 * Run with:  node scripts/test-transition.mjs
 */
import { strict as assert } from 'node:assert'

import { computeInsets } from '../lib/geometry.js'

const FRAME = 1400
const SIDEBAR = 280
/** The panel's settled width, matching a typical 45%-of-viewport track. */
const PANEL = Math.round(FRAME * 0.45 / 4) * 4

/**
 * A scripted stand-in for the layout frame.
 *
 * Only the facts the real measurement reads are modelled: whether the panel
 * reports itself open, the panel's own rect width, and the transitioning column
 * track. Crucially the panel's width is CONSTANT whenever it is open — the real
 * panel is `position: absolute` and slides via `translateX`, so its rect width
 * does not animate, while the grid track does.
 */
class FakeFrame {
  constructor() {
    this.panelOpen = false
    this.trackWidth = 0
    this.fullscreen = false
  }

  /** Open the panel: the attribute flips at once, the track then animates. */
  open() {
    this.panelOpen = true
    this.trackWidth = 0
  }

  /** Close the panel: the attribute clears at once, the track animates back. */
  close() {
    this.panelOpen = false
    this.trackWidth = PANEL
  }

  /** Advance the track animation to `progress` (0..1 of the way to target). */
  animate(progress) {
    this.trackWidth = this.panelOpen ? PANEL * progress : PANEL * (1 - progress)
  }

  /** One measurement, exactly as src/client/frame.ts samples it. */
  measure() {
    return computeInsets({
      frameWidth: FRAME,
      sidebarWidth: SIDEBAR,
      panelOpen: this.panelOpen,
      // Constant while open: the panel slides, it does not resize.
      panelWidth: this.panelOpen ? PANEL : 0,
      columnWidth: this.trackWidth,
      rightbarFullscreen: this.fullscreen,
    })
  }
}

const frame = new FakeFrame()
const steps = []

/** Record one observation, mirroring the observer's "publish on change" rule. */
let published = frame.measure()
function observe(label) {
  const next = frame.measure()
  const changed = next.rightbar !== published.rightbar || next.sidebar !== published.sidebar
  published = next
  steps.push({ label, rightbar: next.rightbar, published: changed })
  return next
}

// 1. closed
assert.equal(observe('initial (closed)').rightbar, 0, 'a closed frame must have no right inset')

// 2. open: the attribute flips; the offset snaps straight to the settled value
frame.open()
const atOpen = observe('open mutation (track 0)')
assert.equal(
  atOpen.rightbar,
  PANEL,
  'opening must apply the panel width at once — deriving it from the animating track makes the offset oscillate',
)

// 3. the transition runs; the offset must NOT move on any frame
for (const progress of [0.25, 0.5, 0.75, 1]) {
  frame.animate(progress)
  const got = observe(`transition ${String(progress * 100)}%`)
  assert.equal(got.rightbar, PANEL, `the offset must hold steady through the open (at ${String(progress * 100)}%)`)
}
assert.equal(observe('settled (open)').rightbar, PANEL, 'the settled offset is the panel width')

// 4. close: attribute clears at once while the track is still wide
frame.close()
const atClose = observe('close mutation (track still wide)')
assert.equal(
  atClose.rightbar,
  0,
  'REGRESSION: closing must clear the offset immediately, even before the track animates back',
)

// 5. the closing animation must never resurrect the offset
for (const progress of [0.25, 0.5, 0.75, 1]) {
  frame.animate(progress)
  const got = observe(`close transition ${String(progress * 100)}%`)
  assert.equal(got.rightbar, 0, `the offset must stay 0 throughout the close (at ${String(progress * 100)}%)`)
}
assert.equal(observe('settled (closed)').rightbar, 0, 'the rail returns flush to the edge and stays there')

// 6. a late, stale "still open width" sample with the panel closed is ignored
const stale = computeInsets({
  frameWidth: FRAME,
  sidebarWidth: SIDEBAR,
  panelOpen: false,
  panelWidth: PANEL,
  columnWidth: PANEL,
  rightbarFullscreen: false,
})
assert.equal(stale.rightbar, 0, 'a stale width with the panel closed cannot become an offset')

for (const step of steps) {
  console.log(`  ${step.label.padEnd(30)} right=${String(step.rightbar).padStart(4)}${step.published ? '  (published)' : ''}`)
}
console.log('\ntransition sequence verified: the rail returns flush to the edge after close')
