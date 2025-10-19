export function isProd(env: Env) {
    return env.ENVIRONMENT === 'production';
}

export function isDev(env: Env) {
    return env.ENVIRONMENT !== 'production';
}
