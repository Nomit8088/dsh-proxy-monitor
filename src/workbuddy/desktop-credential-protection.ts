/**
 * WorkBuddy 5.6 at-rest credential protection.
 *
 * Desktop `workbuddy-desktop.info` stores `auth.accessToken` / `refreshToken`
 * as `{$wbEncrypted:1, envelope}` AES-256-GCM wrappers. The protector key
 * comes from WorkBuddy's Electron `workbuddyStorage.loggerGet()`, reached by
 * spawning *that* binary with `ELECTRON_RUN_AS_NODE=1`.
 *
 * Transcribed from dsh-workbuddy-connect's desktop-credential-protection
 * (corrinehu, WorkBuddy 5.6.2). No token or key material is logged.
 */

import { execFile, execFileSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Why a 5.6 credential could not be opened. */
export type WorkBuddySignedOutReasonCode =
  | 'no-credential'
  | 'encrypted-credential-unreadable'
  | 'electron-path-invalid'
  | 'electron-binary-unavailable'
  | 'electron-binary-not-found'
  | 'credential-region-mismatch'

/** Env override for the WorkBuddy Electron / WorkBuddy.exe binary. */
export const WORKBUDDY_ELECTRON_BIN_ENV = 'WORKBUDDY_ELECTRON_BIN'

const MACOS_ELECTRON_PATH = '/Applications/WorkBuddy.app/Contents/MacOS/Electron'
const AUTH_FIELDS = ['accessToken', 'refreshToken'] as const

/** One decoded field envelope. */
export interface WorkBuddyEnvelope {
  suite: number
  keyId: string
  nonce: Buffer
  authTag: Buffer
  ciphertext: Buffer
}

/** One wrapped token field. */
export interface WrappedAuthField {
  field: (typeof AUTH_FIELDS)[number]
  envelope: WorkBuddyEnvelope
}

/** Classification of a desktop auth document. */
export type DesktopAuthClassification =
  | { format: 'absent' }
  | { format: 'plaintext' }
  | { format: 'encrypted'; wrapped: { document: Record<string, unknown>; fields: readonly WrappedAuthField[] } }
  | { format: 'unrecognized' }

/** Diagnosable helper / decrypt failure. */
export class WorkBuddyElectronPathError extends Error {
  readonly reasonCode: WorkBuddySignedOutReasonCode
  constructor(reasonCode: WorkBuddySignedOutReasonCode, message: string) {
    super(message)
    this.name = 'WorkBuddyElectronPathError'
    this.reasonCode = reasonCode
  }
}

/** Read the reason code off a thrown value. */
export function reasonCodeOf(error: unknown): WorkBuddySignedOutReasonCode | undefined {
  return error instanceof WorkBuddyElectronPathError ? error.reasonCode : undefined
}

/** Distinct envelope key ids, in field order. */
export function keyIdsOf(fields: readonly WrappedAuthField[]): string[] {
  return [...new Set(fields.map(field => field.envelope.keyId))]
}

function parseBase64(value: unknown, length?: number): Buffer | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  let decoded: Buffer
  try {
    decoded = Buffer.from(value, 'base64')
  } catch {
    return undefined
  }
  if (decoded.length === 0 || decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')) {
    return undefined
  }
  return length === undefined || decoded.length === length ? decoded : undefined
}

function parseWrappedField(field: WrappedAuthField['field'], value: unknown): WrappedAuthField | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const wrapped = value as Record<string, unknown>
  if (wrapped['$wbEncrypted'] !== 1 || typeof wrapped['envelope'] !== 'string') return undefined
  let inner: unknown
  try {
    inner = JSON.parse(Buffer.from(wrapped['envelope'], 'base64').toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return undefined
  const parts = inner as Record<string, unknown>
  const nonce = parseBase64(parts['nonce'], 12)
  const authTag = parseBase64(parts['authTag'], 16)
  const ciphertext = parseBase64(parts['ciphertext'])
  if (nonce === undefined || authTag === undefined || ciphertext === undefined) return undefined
  if (parts['suite'] !== 1) return undefined
  if (typeof parts['keyId'] !== 'string' || !/^[0-9a-f]{16}$/u.test(parts['keyId'])) return undefined
  return { field, envelope: { suite: 1, keyId: parts['keyId'], nonce, authTag, ciphertext } }
}

/** Classify a desktop auth document. */
export function classifyDesktopAuthDocument(text: string): DesktopAuthClassification {
  if (text.trim() === '') return { format: 'absent' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { format: 'unrecognized' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { format: 'unrecognized' }
  const document = parsed as Record<string, unknown>
  const auth =
    typeof document['auth'] === 'object' && document['auth'] !== null
      ? (document['auth'] as Record<string, unknown>)
      : document
  const fields: WrappedAuthField[] = []
  for (const field of AUTH_FIELDS) {
    const value = auth[field]
    if (typeof value === 'string') continue
    const wrapped = parseWrappedField(field, value)
    if (wrapped === undefined && value !== undefined) return { format: 'unrecognized' }
    if (wrapped !== undefined) fields.push(wrapped)
  }
  if (fields.length === 0) return { format: 'plaintext' }
  return { format: 'encrypted', wrapped: { document, fields } }
}

/** Replace wrapped fields with plaintext so the regular parser can run. */
export function unwrapDesktopAuthDocument(
  classification: Extract<DesktopAuthClassification, { format: 'encrypted' }>,
  openField: (wrapped: WrappedAuthField) => string,
): string {
  const rebuilt = structuredClone(classification.wrapped.document) as Record<string, unknown>
  const auth =
    typeof rebuilt['auth'] === 'object' && rebuilt['auth'] !== null
      ? (rebuilt['auth'] as Record<string, unknown>)
      : rebuilt
  for (const field of classification.wrapped.fields) {
    auth[field.field] = openField(field)
  }
  return JSON.stringify(rebuilt)
}

/** AAD transcribed from WorkBuddy 5.6.2 `buildAuthenticatedContextAad`. */
export function buildAuthenticatedContextAad(keyId: string, suite: number): Buffer {
  const prefix = Buffer.from('WB-AAD\0', 'ascii')
  const lengthPrefixed = (value: string): Buffer => {
    const bytes = Buffer.from(value, 'utf8')
    const header = Buffer.allocUnsafe(4)
    header.writeUInt32BE(bytes.length)
    return Buffer.concat([header, bytes])
  }
  const suiteBytes = Buffer.allocUnsafe(4)
  suiteBytes.writeUInt32BE(suite)
  return Buffer.concat([
    prefix,
    Buffer.from([1]),
    lengthPrefixed('WBEV1'),
    lengthPrefixed('sym-v1'),
    suiteBytes,
    lengthPrefixed(keyId),
    Buffer.from([2]),
    Buffer.from([0]),
    Buffer.from([0]),
  ])
}

/** Open one envelope; `undefined` when the key or format is wrong. */
export function openAuthField(key: Buffer, envelope: WorkBuddyEnvelope): string | undefined {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.nonce, { authTagLength: 16 })
    decipher.setAAD(buildAuthenticatedContextAad(envelope.keyId, envelope.suite))
    decipher.setAuthTag(envelope.authTag)
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return undefined
  }
}

/** Test helper: seal a field in the 5.6 on-disk shape. */
export function sealAuthFieldForTest(key: Buffer, plaintext: string, suite = 1): { $wbEncrypted: 1; envelope: string } {
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
  cipher.setAAD(buildAuthenticatedContextAad(keyId, suite))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const inner = {
    suite,
    keyId,
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
  return { $wbEncrypted: 1, envelope: Buffer.from(JSON.stringify(inner), 'utf8').toString('base64') }
}

/** `{version:1, atRestSecretKey}` from the Electron helper. */
export interface WorkBuddyAtRestPayload {
  atRestSecretKey: string
}

/** Validate the helper payload. */
export function parseAtRestPayload(text: string): WorkBuddyAtRestPayload | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const payload = parsed as Record<string, unknown>
  if (payload['version'] !== 1) return undefined
  const secret = payload['atRestSecretKey']
  if (typeof secret !== 'string' || secret === '') return undefined
  let decoded: Buffer
  try {
    decoded = Buffer.from(secret, 'base64')
  } catch {
    return undefined
  }
  if (decoded.length !== 32) return undefined
  if (decoded.toString('base64') !== secret) return undefined
  if (decoded.every(byte => byte === 0)) return undefined
  return { atRestSecretKey: secret }
}

/** Protector key = sha256(utf8 secret). */
export function deriveProtectorKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/** Pick WorkBuddy.exe out of `reg query` text; never the uninstaller. */
export function pickWorkBuddyExeFromRegistry(stdout: string): string | undefined {
  const matches = [...stdout.matchAll(/([A-Za-z]:\\[^\r\n"]*\\WorkBuddy\.exe)/giu)].map(match => match[1]!.trim())
  return matches.find(path => !/\\Uninstall WorkBuddy\.exe$/iu.test(path) && fileExists(path))
}

/** Windows uninstall DisplayIcon for WorkBuddy.exe, if present. */
function windowsUninstallWorkBuddyExe(): string | undefined {
  const windir = process.env['windir'] ?? process.env['SystemRoot'] ?? 'C:\\Windows'
  const reg = join(windir, 'System32', 'reg.exe')
  const hives = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  for (const hive of hives) {
    try {
      const stdout = execFileSync(reg, ['query', hive, '/s', '/f', 'WorkBuddy.exe'], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const picked = pickWorkBuddyExeFromRegistry(stdout)
      if (picked !== undefined) return picked
    } catch {
      /* hive missing or reg blocked */
    }
  }
  return undefined
}

/** Extra Windows install locations beyond the store / Local\\Programs default. */
function windowsWorkBuddyGuesses(): string[] {
  const local = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
  return [
    join(local, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'),
    join(local, 'WorkBuddy', 'WorkBuddy.exe'),
    join(homedir(), 'AppData', 'Local', 'Programs', 'WorkBuddy', 'WorkBuddy.exe'),
    'D:\\dev\\agent_dev\\workbuddy\\WorkBuddy.exe',
    'C:\\dev\\agent_dev\\workbuddy\\WorkBuddy.exe',
  ]
}

/** Electron / WorkBuddy.exe this machine should spawn for the key helper. */
export function resolveWorkBuddyElectronPath(): string | undefined {
  const fromEnv = process.env[WORKBUDDY_ELECTRON_BIN_ENV]?.trim()
  if (fromEnv !== undefined && fromEnv !== '' && fileExists(fromEnv)) return fromEnv
  if (process.platform === 'darwin' && fileExists(MACOS_ELECTRON_PATH)) return MACOS_ELECTRON_PATH
  if (process.platform === 'win32') {
    const fromReg = windowsUninstallWorkBuddyExe()
    if (fromReg !== undefined) return fromReg
    return windowsWorkBuddyGuesses().find(fileExists)
  }
  return undefined
}

const HELPER_SCRIPT =
  'process.stdout.write(String(process._linkedBinding("electron_browser_workbuddy_storage").loggerGet()))'

interface ResolvedKey {
  key: Buffer
  keyId: string
}

/** In-memory protector-key resolver: one spawn per process, never persisted. */
export class WorkBuddyAtRestKeyProvider {
  private cache: ResolvedKey | undefined
  private inflight: Promise<ResolvedKey> | undefined
  private readonly timeoutMs: number
  private readonly electronPathOverride: string | undefined

  constructor(options: { electronPath?: string; timeoutMs?: number } = {}) {
    this.electronPathOverride = options.electronPath
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  /** Binary that would be spawned; diagnostics only. */
  helperPath(): string | undefined {
    return this.electronPathOverride ?? resolveWorkBuddyElectronPath()
  }

  /** Protector key matching one of the envelope ids. */
  async protectorKeyFor(requested: readonly string[]): Promise<Buffer> {
    if (requested.length === 0) {
      throw new WorkBuddyElectronPathError('encrypted-credential-unreadable', 'encrypted desktop credential carries no key ids')
    }
    const cached = this.cache
    if (cached !== undefined && requested.includes(cached.keyId)) return cached.key
    this.inflight ??= this.spawnPayload()
      .then(text => this.ingest(text))
      .finally(() => {
        this.inflight = undefined
      })
    const resolved = await this.inflight
    if (!requested.includes(resolved.keyId)) {
      throw new WorkBuddyElectronPathError(
        'encrypted-credential-unreadable',
        `WorkBuddy's current at-rest key (id ${resolved.keyId}) does not match the credential's envelope (id ${requested.join(' or ')}); open the WorkBuddy app once to reseal the sign-in`,
      )
    }
    return resolved.key
  }

  private ingest(text: string): ResolvedKey {
    const payload = parseAtRestPayload(text)
    if (payload === undefined) {
      throw new WorkBuddyElectronPathError(
        'encrypted-credential-unreadable',
        'WorkBuddy key helper returned an unusable at-rest payload',
      )
    }
    const key = deriveProtectorKey(payload.atRestSecretKey)
    const resolved: ResolvedKey = {
      key,
      keyId: createHash('sha256').update(key).digest('hex').slice(0, 16),
    }
    this.cache = resolved
    return resolved
  }

  private async spawnPayload(): Promise<string> {
    const electronPath = this.helperPath()
    if (electronPath === undefined || electronPath === '') {
      throw new WorkBuddyElectronPathError(
        'electron-binary-unavailable',
        `WorkBuddy 5.6 encrypted the desktop sign-in; open the WorkBuddy app once, or set ${WORKBUDDY_ELECTRON_BIN_ENV} to WorkBuddy.exe`,
      )
    }
    return await new Promise<string>((resolve, reject) => {
      execFile(
        electronPath,
        ['-e', HELPER_SCRIPT],
        {
          timeout: this.timeoutMs,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        },
        (error, stdout) => {
          if (error !== null && error !== undefined) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'ENOENT') {
              reject(
                new WorkBuddyElectronPathError(
                  'electron-binary-not-found',
                  `WorkBuddy.exe was not found at ${electronPath}; open the WorkBuddy desktop app once, or set ${WORKBUDDY_ELECTRON_BIN_ENV}`,
                ),
              )
              return
            }
            const reason =
              error.killed === true
                ? `timed out after ${String(this.timeoutMs)}ms`
                : error.code !== undefined
                  ? `exited with code ${String(error.code)}`
                  : 'could not be started'
            reject(
              new WorkBuddyElectronPathError(
                'encrypted-credential-unreadable',
                `the WorkBuddy key helper (${electronPath}) ${reason}`,
              ),
            )
            return
          }
          const output = stdout.trim()
          if (output === '') {
            reject(
              new WorkBuddyElectronPathError(
                'encrypted-credential-unreadable',
                `the WorkBuddy key helper (${electronPath}) produced no payload`,
              ),
            )
            return
          }
          resolve(output)
        },
      )
    })
  }
}
