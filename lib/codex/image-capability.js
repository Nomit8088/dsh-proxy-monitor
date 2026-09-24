/** Require the current conversation model to accept the image block a tool returns. */
export async function assertImageCapable(ctx, exec, action) {
    const configured = exec.agent?.session.requestHeader()?.config;
    const provider = configured?.provider ?? exec.agent?.options.provider;
    const model = configured?.model ?? exec.agent?.options.model;
    if (provider === undefined || model === undefined) {
        throw new Error(`cannot ${action}: the current model route is unavailable`);
    }
    const info = await ctx.llm.resolveModelInfo(provider, model, exec.signal);
    if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
        throw new Error(`cannot ${action}: model "${model}" does not declare image input`);
    }
}
//# sourceMappingURL=image-capability.js.map