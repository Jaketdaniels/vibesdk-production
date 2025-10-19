/**
 * Extend API client with Passkey methods
 */

import { ApiClient } from './api-client';

declare module './api-client' {
  interface ApiClient {
    getPasskeyRegOptions(data: { email?: string; displayName?: string }): Promise<any>;
    verifyPasskeyReg(data: { credential: any; challenge: string; email?: string; displayName?: string }): Promise<any>;
    getPasskeyAuthOptions(): Promise<any>;
    verifyPasskeyAuth(data: { credential: any; challenge: string }): Promise<any>;
  }
}

ApiClient.prototype.getPasskeyRegOptions = function (this: ApiClient, data: { email?: string; displayName?: string }) {
  // @ts-ignore accessing private method via public wrapper
  return (this as any).request('/api/auth/passkey/register/options', {
    method: 'POST',
    body: data,
  });
};

ApiClient.prototype.verifyPasskeyReg = function (this: ApiClient, data: { credential: any; challenge: string; email?: string; displayName?: string }) {
  // @ts-ignore accessing private method via public wrapper
  return (this as any).request('/api/auth/passkey/register/verify', {
    method: 'POST',
    body: data,
  });
};

ApiClient.prototype.getPasskeyAuthOptions = function (this: ApiClient) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/auth/options', { method: 'POST' });
};

ApiClient.prototype.verifyPasskeyAuth = function (this: ApiClient, data: { credential: any; challenge: string }) {
  // @ts-ignore
  return (this as any).request('/api/auth/passkey/auth/verify', {
    method: 'POST',
    body: data,
  });
};
