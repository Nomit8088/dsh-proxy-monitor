export async function readBoundedResponseText(response, maxBytes, signal, errors) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await cancelResponseBody(response);
        throw errors.tooLarge();
    }
    if (response.body === null)
        return '';
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            if (signal?.aborted === true && errors.cancelled !== undefined)
                throw errors.cancelled();
            const next = await reader.read();
            if (next.done)
                break;
            total += next.value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw errors.tooLarge();
            }
            chunks.push(next.value);
        }
    }
    catch (error) {
        if (signal?.aborted === true && errors.cancelled !== undefined)
            throw errors.cancelled();
        throw error;
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}
async function cancelResponseBody(response) {
    try {
        await response.body?.cancel();
    }
    catch { /* discard best-effort */ }
}
//# sourceMappingURL=bounded-response.js.map