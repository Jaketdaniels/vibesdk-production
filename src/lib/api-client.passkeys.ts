/**
 * Extend API client with Passkey methods (send cookies + CSRF header)
 */

import { ApiClient } from './api-client';

declare module './api-client' {
  interface ApiClient {
    getPasskeyRegOptions(data: { email: string; displayName?: string }): Promise<any>;
    verifyPasskeyReg(data: { credential: any; challenge: string; email: string; displayName?: string }): Promise<any>;
    getPasskeyAuthOptions(): Promise<any>;
    verifyPasskeyAuth(data: { credential: any; challenge: string }): Promise<any>;
    listPasskeyCredentials(): Promise<any>;
    renamePasskey(data: { credentialId: string; name: string }): Promise<any>;
    deletePasskey(data: { credentialId: string }): Promise<any>;
  }
}

function withCsrfHeaders(this: ApiClient, init: any = {}) {
  const headers = new Headers(init.headers || {});
  // Try to pull CSRF token from cookie that CsrfService sets (sameSite Lax)
  const csrfCookie = document.cookie.split('; ').find(c => c.startsWith('csrfToken='));
  if (csrfCookie) {
    const token = decodeURIComponent(csrfCookie.split('=')[1]);
    headers.set('X-CSRF-Token', token);
  }
  return { ...init, headers, credentials: 'include' as RequestCredentials };
}

ApiClient.prototype.getPasskeyRegOptions = function (this: ApiClient, data: { email: string; displayName?: string }) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/register/options', withCsrfHeaders.call(this, { method: 'POST', body: data }));
};

ApiClient.prototype.verifyPasskeyReg = function (this: ApiClient, data: { credential: any; challenge: string; email: string; displayName?: string }) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/register/verify', withCsrfHeaders.call(this, { method: 'POST', body: data }));
};

ApiClient.prototype.getPasskeyAuthOptions = function (this: ApiClient) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/auth/options', withCsrfHeaders.call(this, { method: 'POST' }));
};

ApiClient.prototype.verifyPasskeyAuth = function (this: ApiClient, data: { credential: any; challenge: string }) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/auth/verify', withCsrfHeaders.call(this, { method: 'POST', body: data }));
};

ApiClient.prototype.listPasskeyCredentials = function (this: ApiClient) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/credentials', withCsrfHeaders.call(this, { method: 'GET' }));
};

ApiClient.prototype.renamePasskey = function (this: ApiClient, data: { credentialId: string; name: string }) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/credentials', withCsrfHeaders.call(this, { method: 'PATCH', body: data }));
};

ApiClient.prototype.deletePasskey = function (this: ApiClient, data: { credentialId: string }) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/credentials', withCsrfHeaders.call(this, { method: 'DELETE', body: data }));
};
