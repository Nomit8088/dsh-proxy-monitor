/**
 * OpenAI Codex OAuth orchestration shared by the plugin and standalone launcher.
 * @module dsh-codex/auth
 */
import { createModels } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { OpenAICodexCredentialStore, OPENAI_CODEX_PROVIDER } from './store.js';
/**
 * Complete provider-native OAuth and persist the resulting credential.
 * @param interaction - terminal or UI callbacks for the provider flow.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 */
export async function loginOpenAICodex(interaction, store = new OpenAICodexCredentialStore()) {
    const models = createModels({ credentials: store });
    models.setProvider(openaiCodexProvider());
    await models.login(OPENAI_CODEX_PROVIDER, 'oauth', interaction);
}
/**
 * Remove the stored OpenAI Codex credential.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 */
export async function logoutOpenAICodex(store = new OpenAICodexCredentialStore()) {
    await store.delete(OPENAI_CODEX_PROVIDER);
}
/**
 * Read non-secret OpenAI Codex login state without refreshing the token.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 * @returns stored login state and expiry.
 */
export async function openAICodexAuthStatus(store = new OpenAICodexCredentialStore()) {
    const credential = await store.read(OPENAI_CODEX_PROVIDER);
    return credential?.type === 'oauth'
        ? { authenticated: true, expiresAt: new Date(credential.expires) }
        : { authenticated: false };
}
//# sourceMappingURL=auth.js.map