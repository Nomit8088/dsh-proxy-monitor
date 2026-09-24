/**
 * Provider marks.
 *
 * Each mark is an inline SVG drawn in `currentColor` so it inherits the ring's
 * state colour (and therefore the theme) instead of carrying a hard-coded
 * brand fill that would fight the surrounding chrome in one of the two
 * schemes. The shapes follow each vendor's public logo geometry closely enough
 * to be recognizable at 20px, which is all a 44px ring affords.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/icons
 */

import type { ReactNode } from 'react'

/** Props shared by every provider mark. */
export interface MarkProps {
  /** Rendered box in px; the rail uses 18-20. */
  size?: number
}

/** DeepSeek: the whale tail over a wave. */
function DeepSeekMark({ size = 20 }: MarkProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.6c-3.5 0-6.3 2.5-6.3 5.9 0 1.5.5 2.8 1.4 3.8-.5.2-1.3.6-1.9 1.3-.8.9-1.1 2-1.1 3.1 0 .5.4.9.9.9.4 0 .7-.2.8-.6.2-.8.6-1.5 1.2-2 .5-.4 1-.6 1.4-.7.9.6 2 1 3.6 1 1.6 0 2.7-.4 3.6-1 .4.1.9.3 1.4.7.6.5 1 1.2 1.2 2 .1.4.4.6.8.6.5 0 .9-.4.9-.9 0-1.1-.3-2.2-1.1-3.1-.6-.7-1.4-1.1-1.9-1.3.9-1 1.4-2.3 1.4-3.8 0-3.4-2.8-5.9-6.3-5.9Zm0 2c2.4 0 4.3 1.7 4.3 3.9S14.4 12.4 12 12.4 7.7 10.7 7.7 8.5 9.6 4.6 12 4.6Z" />
      <circle cx="9.9" cy="8.2" r="1.15" />
      <circle cx="14.1" cy="8.2" r="1.15" />
    </svg>
  )
}

/** OpenAI / Codex: the interlocking knot, simplified to its outer lobes. */
function CodexMark({ size = 20 }: MarkProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M12 3.2 19 7.2v8l-7 4-7-4v-8l7-4Z" strokeLinejoin="round" />
      <path d="M12 3.2v8m0 0 7-4m-7 4-7-4m7 4v8" strokeLinecap="round" />
    </svg>
  )
}

/** Google / Gemini: the four-point star. */
function GeminiMark({ size = 20 }: MarkProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.2c.7 4.6 2.4 6.9 7.6 7.6-5 .7-6.9 3-7.6 7.6-.7-4.6-2.4-6.9-7.6-7.6 5-.7 6.9-3 7.6-7.6Zm5.6 11.4c.3 2 1 3 3.2 3.3-2.1.3-2.9 1.3-3.2 3.3-.3-2-1-3-3.2-3.3 2.2-.3 2.9-1.3 3.2-3.3Z" />
    </svg>
  )
}

/** xAI / Grok: the slashed square. */
function GrokMark({ size = 20 }: MarkProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.4" />
      <path d="m8.2 15.8 7.6-7.6M8.6 8.6l6.8 6.8" strokeLinecap="round" />
    </svg>
  )
}

/** Anthropic / Claude: the radiating burst. */
function ClaudeMark({ size = 20 }: MarkProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g strokeLinecap="round">
        <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
      </g>
    </svg>
  )
}

/** WorkBuddy: a rounded terminal prompt, matching the desktop app's mark. */
function WorkBuddyMark({ size = 20 }: MarkProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3.2" y="4.4" width="17.6" height="15.2" rx="3.4" />
      <path d="m7.6 9.6 2.6 2.4-2.6 2.4M12.4 14.8h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The mark for a provider id; a neutral dot for an unknown one. */
export function providerMark(id: string, size = 20): ReactNode {
  switch (id) {
    case 'deepseek':
      return <DeepSeekMark size={size} />
    case 'codex':
      return <CodexMark size={size} />
    case 'antigravity':
      return <GeminiMark size={size} />
    case 'grok':
      return <GrokMark size={size} />
    case 'claude':
      return <ClaudeMark size={size} />
    case 'workbuddy':
      return <WorkBuddyMark size={size} />
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
        </svg>
      )
  }
}
