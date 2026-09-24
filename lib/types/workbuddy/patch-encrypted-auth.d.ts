/**
 * Teach the vendored WorkBuddyCredentialStore to open WorkBuddy 5.6
 * `$wbEncrypted` desktop files. The store still lives in the bundled JS;
 * this patches `readDesktop` before `apply()` runs.
 */
/**
 * Replace `readDesktop` so encrypted 5.6 documents are opened instead of
 * treated as signed-out.
 */
export declare function patchWorkBuddyEncryptedAuth(): void;
