/** Browser-safe dedicated Connection RPC contract owned by grok-auth. */
/** Logical channel registered by the plugin's Host half and called by its browser half. */
export const GROK_AUTH_RPC_CHANNEL = '/grok-auth';
/** Build the browser face over Connection's plugin-owned unary channel. */
export function createGrokAuthRpcClient(rpc) {
    return {
        status: async (signal) => {
            const result = await rpc.call(GROK_AUTH_RPC_CHANNEL, 'status', {}, signal);
            if (!result.ok)
                return result;
            const status = parseStatusResult(result.value);
            return status === undefined ? invalidResponse('status') : { ok: true, value: { status } };
        },
        usage: async (signal) => {
            const result = await rpc.call(GROK_AUTH_RPC_CHANNEL, 'usage', {}, signal);
            if (!result.ok)
                return result;
            const usage = parseUsageResult(result.value);
            return usage === undefined ? invalidResponse('usage') : { ok: true, value: { usage } };
        },
        login: async (mode, signal) => {
            const result = await rpc.call(GROK_AUTH_RPC_CHANNEL, 'login', { mode }, signal);
            if (!result.ok)
                return result;
            const login = parseLoginResult(result.value);
            return login === undefined ? invalidResponse('login') : { ok: true, value: { login } };
        },
    };
}
function parseStatusResult(value) {
    if (!isRecord(value) || !isRecord(value.status))
        return undefined;
    const status = value.status;
    if (typeof status.available !== 'boolean'
        || typeof status.configured !== 'boolean'
        || typeof status.credentialRef !== 'string'
        || typeof status.authFileExists !== 'boolean')
        return undefined;
    for (const key of ['authMode', 'grokVersion', 'tokenExpiresAt', 'createdAt', 'email', 'lastLoginError']) {
        if (status[key] !== undefined && typeof status[key] !== 'string')
            return undefined;
    }
    let pendingLogin;
    if (status.pendingLogin !== undefined) {
        if (!isRecord(status.pendingLogin)
            || typeof status.pendingLogin.userCode !== 'string'
            || typeof status.pendingLogin.verificationUri !== 'string'
            || typeof status.pendingLogin.expiresAt !== 'string')
            return undefined;
        pendingLogin = {
            userCode: status.pendingLogin.userCode,
            verificationUri: status.pendingLogin.verificationUri,
            expiresAt: status.pendingLogin.expiresAt,
        };
    }
    return {
        available: status.available,
        configured: status.configured,
        ...typeof status.authMode === 'string' ? { authMode: status.authMode } : {},
        ...typeof status.grokVersion === 'string' ? { grokVersion: status.grokVersion } : {},
        ...typeof status.tokenExpiresAt === 'string' ? { tokenExpiresAt: status.tokenExpiresAt } : {},
        ...typeof status.createdAt === 'string' ? { createdAt: status.createdAt } : {},
        ...typeof status.email === 'string' ? { email: status.email } : {},
        credentialRef: status.credentialRef,
        authFileExists: status.authFileExists,
        ...pendingLogin === undefined ? {} : { pendingLogin },
        ...typeof status.lastLoginError === 'string' ? { lastLoginError: status.lastLoginError } : {},
    };
}
function parseUsageResult(value) {
    if (!isRecord(value) || !isRecord(value.usage))
        return undefined;
    const usage = value.usage;
    if (usage.weeklyResetAt !== undefined && typeof usage.weeklyResetAt !== 'string')
        return undefined;
    if (usage.weeklyRemainingPercent !== undefined
        && (!Number.isSafeInteger(usage.weeklyRemainingPercent)
            || usage.weeklyRemainingPercent < 0
            || usage.weeklyRemainingPercent > 100))
        return undefined;
    return {
        ...typeof usage.weeklyRemainingPercent === 'number' ? { weeklyRemainingPercent: usage.weeklyRemainingPercent } : {},
        ...typeof usage.weeklyResetAt === 'string' ? { weeklyResetAt: usage.weeklyResetAt } : {},
    };
}
function parseLoginResult(value) {
    if (!isRecord(value) || !isRecord(value.login))
        return undefined;
    const login = value.login;
    if (typeof login.started !== 'boolean')
        return undefined;
    if (login.userCode !== undefined && typeof login.userCode !== 'string')
        return undefined;
    if (login.verificationUri !== undefined && typeof login.verificationUri !== 'string')
        return undefined;
    if (login.expiresInSeconds !== undefined && typeof login.expiresInSeconds !== 'number')
        return undefined;
    return {
        started: login.started,
        ...typeof login.userCode === 'string' ? { userCode: login.userCode } : {},
        ...typeof login.verificationUri === 'string' ? { verificationUri: login.verificationUri } : {},
        ...typeof login.expiresInSeconds === 'number' ? { expiresInSeconds: login.expiresInSeconds } : {},
    };
}
function invalidResponse(endpoint) {
    return {
        ok: false,
        error: {
            code: 'internal',
            message: `grok-auth: invalid ${endpoint} response from Host`,
            details: {},
        },
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=rpc-contract.js.map