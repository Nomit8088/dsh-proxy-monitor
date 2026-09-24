/**
 * Teach the vendored WorkBuddyCredentialStore to open WorkBuddy 5.6
 * `$wbEncrypted` desktop files. The store still lives in the bundled JS;
 * this patches `readDesktop` before `apply()` runs.
 */

import { readFile } from 'node:fs/promises'

import {
  WorkBuddyAtRestKeyProvider,
  WorkBuddyElectronPathError,
  classifyDesktopAuthDocument,
  keyIdsOf,
  openAuthField,
  unwrapDesktopAuthDocument,
} from './desktop-credential-protection.js'
import { parseWorkBuddyAuth, WorkBuddyCredentialStore } from './index.js'

const keyProvider = new WorkBuddyAtRestKeyProvider()

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Replace `readDesktop` so encrypted 5.6 documents are opened instead of
 * treated as signed-out.
 */
export function patchWorkBuddyEncryptedAuth(): void {
  const proto = WorkBuddyCredentialStore.prototype as unknown as {
    readDesktop?: () => Promise<unknown>
    resolveDesktopCandidates?: () => string[]
  }
  proto.readDesktop = async function readDesktop(): Promise<unknown> {
    const candidates = typeof proto.resolveDesktopCandidates === 'function'
      ? proto.resolveDesktopCandidates.call(this)
      : []
    for (const desktopPath of candidates) {
      let text: string
      try {
        text = await readFile(desktopPath, 'utf8')
      } catch (error: unknown) {
        if (!isENOENT(error)) throw error
        continue
      }
      const classification = classifyDesktopAuthDocument(text)
      if (classification.format === 'plaintext') return parseWorkBuddyAuth(text)
      if (classification.format === 'absent') continue
      if (classification.format === 'unrecognized') {
        throw new WorkBuddyElectronPathError(
          'encrypted-credential-unreadable',
          `the desktop auth file at ${desktopPath} exists but is unreadable (neither plaintext nor a WorkBuddy 5.6 envelope)`,
        )
      }
      const key = await keyProvider.protectorKeyFor(keyIdsOf(classification.wrapped.fields))
      const opened = unwrapDesktopAuthDocument(classification, field => {
        const plaintext = openAuthField(key, field.envelope)
        if (plaintext === undefined) {
          throw new WorkBuddyElectronPathError(
            'encrypted-credential-unreadable',
            `the encrypted desktop credential's ${field.field} could not be decrypted (envelope key id ${field.envelope.keyId})`,
          )
        }
        return plaintext
      })
      return parseWorkBuddyAuth(opened)
    }
    return undefined
  }
}
