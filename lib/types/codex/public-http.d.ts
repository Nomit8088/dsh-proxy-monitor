/** Public-network-only HTTP(S) reader used by the optional remote image path. */
/** Maximum time one DNS-plus-HTTP hop may occupy. */
export declare const PUBLIC_HTTP_HOP_TIMEOUT_MS = 30000;
/** Redirect ceiling retained from the original remote-image behavior. */
export declare const PUBLIC_HTTP_MAX_REDIRECTS = 5;
/** One address returned by the resolver and later pinned into the socket lookup. */
export interface ResolvedNetworkAddress {
    address: string;
    family: 4 | 6;
}
/** One HTTP hop after response framing and the byte ceiling have been enforced. */
export interface PublicHttpHop {
    status: number;
    location?: string;
    data?: Uint8Array;
}
/** Injectable boundary used by deterministic SSRF regression tests. */
export interface PublicHttpRuntime {
    resolve(hostname: string, signal: AbortSignal): Promise<readonly ResolvedNetworkAddress[]>;
    get(url: URL, address: ResolvedNetworkAddress, maxBytes: number, signal: AbortSignal): Promise<PublicHttpHop>;
}
/** Bytes plus the final, post-redirect public URL. */
export interface PublicHttpResource {
    data: Uint8Array;
    display: string;
    name?: string;
}
/** Whether an address is ordinary public unicast rather than a local/special target. */
export declare function isPublicNetworkAddress(rawAddress: string): boolean;
/** Collect one response body while enforcing declared and streaming size limits. */
export declare function collectBoundedBytes(body: AsyncIterable<Uint8Array | string>, declaredLength: string | undefined, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
/** Production resolver and one-shot agent which pins the validated address. */
export declare const NODE_PUBLIC_HTTP_RUNTIME: PublicHttpRuntime;
/** Fetch bytes from a public HTTP(S) target, revalidating and repinning each redirect. */
export declare function fetchPublicHttpResource(source: string, maxBytes: number, signal: AbortSignal, runtime?: PublicHttpRuntime): Promise<PublicHttpResource>;
