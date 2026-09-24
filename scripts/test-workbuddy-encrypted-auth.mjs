/**
 * WorkBuddy 5.6 at-rest envelope classification and AES-GCM round-trip.
 * Run with: node scripts/test-workbuddy-encrypted-auth.mjs
 */
import { createHash, randomBytes } from 'node:crypto'

import {
  classifyDesktopAuthDocument,
  deriveProtectorKey,
  openAuthField,
  parseAtRestPayload,
  sealAuthFieldForTest,
  unwrapDesktopAuthDocument,
} from '../lib/workbuddy/desktop-credential-protection.js'

let failed = 0
function check(label, condition) {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failed += 1
}

const secret = randomBytes(32).toString('base64')
const key = deriveProtectorKey(secret)
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig'
const sealed = sealAuthFieldForTest(key, token)
const document = JSON.stringify({
  account: { uid: 'user-1', nickname: 'TIMON' },
  auth: { accessToken: sealed, refreshToken: 'refresh-plain', domain: 'www.workbuddy.cn', expiresAt: 1_900_000_000_000 },
})

const classified = classifyDesktopAuthDocument(document)
check('encrypted document is classified encrypted', classified.format === 'encrypted')
check('accessToken is the wrapped field', classified.format === 'encrypted' && classified.wrapped.fields[0]?.field === 'accessToken')

if (classified.format === 'encrypted') {
  const opened = unwrapDesktopAuthDocument(classified, field => {
    const plain = openAuthField(key, field.envelope)
    if (plain === undefined) throw new Error('open failed')
    return plain
  })
  const parsed = JSON.parse(opened)
  check('unwrap restores the jwt', parsed.auth.accessToken === token)
  check('unwrap leaves plaintext refreshToken', parsed.auth.refreshToken === 'refresh-plain')
}

check('plaintext document stays plaintext', classifyDesktopAuthDocument('{"auth":{"accessToken":"abc"}}').format === 'plaintext')
check('empty file is absent', classifyDesktopAuthDocument('  ').format === 'absent')
check('junk json is unrecognized', classifyDesktopAuthDocument('{').format === 'unrecognized')

const payload = parseAtRestPayload(JSON.stringify({ version: 1, atRestSecretKey: secret }))
check('valid helper payload parses', payload?.atRestSecretKey === secret)
check('all-zero secret is rejected', parseAtRestPayload(JSON.stringify({ version: 1, atRestSecretKey: Buffer.alloc(32).toString('base64') })) === undefined)

const wrongKey = createHash('sha256').update('nope', 'utf8').digest()
if (classified.format === 'encrypted') {
  check('wrong key does not open', openAuthField(wrongKey, classified.wrapped.fields[0].envelope) === undefined)
}

const registryBlob = [
  'DisplayIcon    REG_SZ    D:\\dev\\agent_dev\\workbuddy\\Uninstall WorkBuddy.exe,0',
  'DisplayIcon    REG_SZ    D:\\dev\\agent_dev\\workbuddy\\WorkBuddy.exe,0',
].join('\n')
const picked = [...registryBlob.matchAll(/([A-Za-z]:\\[^\r\n"]*\\WorkBuddy\.exe)/giu)]
  .map(match => match[1].trim())
  .find(path => !/\\Uninstall WorkBuddy\.exe$/iu.test(path))
check('uninstall.exe is not chosen as the helper', picked === 'D:\\dev\\agent_dev\\workbuddy\\WorkBuddy.exe')

if (failed > 0) {
  console.error(`\n${String(failed)} workbuddy encryption check(s) failed`)
  process.exit(1)
}
console.log('\nworkbuddy 5.6 envelope checks passed')
