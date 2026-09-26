/**
 * Producer identity for the user-role context this provider injects.
 *
 * DSH 0.1.7's message-source vocabulary is a merge-extensible sum type with no
 * shared catch-all `plugin` kind: each producer declares its own key in its own
 * module (the shapes `user-rpc` and `model-selection` use). Both injection
 * sites — the `imagegen` tool and the enhanced `read_image` — therefore declare
 * the one key below, and build their source through this module so the two
 * cannot drift apart.
 *
 * @module @dsh-external/dsh-proxy-monitor/codex/context-source
 */

/** Key this provider declares in `MessageSourceMap`. */
export const OPENAI_CODEX_CONTEXT_SOURCE = 'openai-codex-context'

/** Plugin name recorded on every injected message. */
export const OPENAI_CODEX_PLUGIN_NAME = 'dsh-openai-codex'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Context injected into the conversation by the OpenAI Codex provider.
     *
     * The `kind` stays `'user'` because the message it labels is a user-role
     * message: the extra `plugin` field is attribution, not a second role (the
     * same construction `user-rpc` uses for browser-originated prompts).
     */
    'openai-codex-context': {
      kind: 'user'
      /** Producing plugin, so a consumer can attribute the row. */
      plugin: string
    }
  }
}

/**
 * Build the source record for one injected context message.
 * @returns the declared source variant.
 */
export function openAICodexContextSource(): {
  kind: 'user'
  plugin: string
} {
  return { kind: 'user', plugin: OPENAI_CODEX_PLUGIN_NAME }
}
