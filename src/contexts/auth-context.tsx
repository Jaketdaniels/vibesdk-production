/**
 * Auth Context: deterministic WebAuthn orchestration
 * - No conditional mediation
 * - Clear error mapping, 60s timeout, limited retry for registration network errors
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { apiClient, ApiError } from '@/lib/api-client';
import { useSentryUser } from '@/hooks/useSentryUser';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type { AuthSession, AuthUser } from '../api-types';

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  authProviders: { passkey: boolean; google: boolean; github: boolean; email: boolean; } | null;
  hasPasskey: boolean;
  hasOAuth: boolean;
  requiresEmailAuth: boolean;
  loginWithPasskey: () => Promise<void>;
  registerPasskey: (email?: string, displayName?: string) => Promise<void>;
  login: (provider: 'google' | 'github', redirectUrl?: string) => void;
  loginWithEmail: (credentials: { email: string; password: string }) => Promise<void>;
  register: (data: { email: string; password: string; name?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
  setIntendedUrl: (url: string) => void;
  getIntendedUrl: () => string | null;
  clearIntendedUrl: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TIMEOUT_MS = 60000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authProviders, setAuthProviders] = useState<{ passkey: boolean; google: boolean; github: boolean; email: boolean; } | null>(null);
  const [hasPasskey, setHasPasskey] = useState<boolean>(true);
  const [hasOAuth, setHasOAuth] = useState<boolean>(false);
  const [requiresEmailAuth, setRequiresEmailAuth] = useState<boolean>(false);
  const navigate = useNavigate();
  useSentryUser(user);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const INTENDED_URL_KEY = 'auth_intended_url';
  const setIntendedUrl = useCallback((url: string) => { try { sessionStorage.setItem(INTENDED_URL_KEY, url); } catch {} }, []);
  const getIntendedUrl = useCallback((): string | null => { try { return sessionStorage.getItem(INTENDED_URL_KEY); } catch { return null; } }, []);
  const clearIntendedUrl = useCallback(() => { try { sessionStorage.removeItem(INTENDED_URL_KEY); } catch {} }, []);

  const mapPasskeyError = useCallback((err: any): string => {
    if (err instanceof Error) {
      if (err.name === 'NotAllowedError') return 'Authentication was cancelled or timed out. Please try again.';
      if (err.name === 'NotSupportedError') return 'Passkeys are not supported on this device or browser.';
      if (err.name === 'SecurityError') return 'Security error occurred. Ensure you\'re on a secure connection.';
      if (err.message?.includes('CREDENTIAL_NOT_FOUND')) return 'No passkey found on this device for this site.';
      if (err.message?.includes('CHALLENGE_EXPIRED')) return 'Authentication challenge expired. Please try again.';
      return err.message;
    }
    return 'Connection error. Please try again.';
  }, []);

  const fetchAuthProviders = useCallback(async () => {
    try {
      const response = await apiClient.getAuthProviders();
      if (response.success && response.data) {
        setAuthProviders(response.data.providers);
        setHasPasskey(response.data.providers.passkey);
        setHasOAuth(response.data.hasOAuth);
        setRequiresEmailAuth(response.data.requiresEmailAuth);
      }
    } catch {
      setAuthProviders({ passkey: true, google: false, github: false, email: true });
      setHasPasskey(true);
      setHasOAuth(false);
      setRequiresEmailAuth(false);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const response = await apiClient.getProfile(true);
      if (response.success && response.data?.user) {
        setUser({ ...response.data.user, isAnonymous: false } as AuthUser);
        setToken(null);
        setSession({ userId: response.data.user.id, email: response.data.user.email, sessionId: response.data.sessionId || response.data.user.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
        setupTokenRefresh();
      } else {
        setUser(null); setToken(null); setSession(null);
      }
    } catch {
      setUser(null); setToken(null); setSession(null);
    } finally { setIsLoading(false); }
  }, []);

  const setupTokenRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(async () => { try { const resp = await apiClient.getProfile(true); if (!resp.success) { setUser(null); setToken(null); setSession(null); clearInterval(refreshTimerRef.current!); } } catch {} }, 60 * 60 * 1000);
  }, []);

  useEffect(() => { return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); }; }, []);
  useEffect(() => { (async () => { await fetchAuthProviders(); await checkAuth(); })(); }, [fetchAuthProviders, checkAuth]);

  const loginWithPasskey = useCallback(async () => {
    setError(null); setIsLoading(true);
    try {
      if (!window.PublicKeyCredential) throw new Error('Passkeys are not supported in this browser.');
      const optionsResponse = await apiClient.getPasskeyAuthOptions();
      if (!optionsResponse.success || !optionsResponse.data) throw new Error(optionsResponse.error || 'Failed to get authentication options');

      const authResponse = await Promise.race([
        startAuthentication({ optionsJSON: optionsResponse.data.options }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Authentication timed out after 60 seconds')), TIMEOUT_MS))
      ]) as any;

      const verifyResponse = await apiClient.verifyPasskeyAuth({ credential: authResponse, challenge: optionsResponse.data.challenge });
      if (verifyResponse.success && verifyResponse.data) {
        setUser({ ...verifyResponse.data.user, isAnonymous: false } as AuthUser);
        setToken(null);
        setSession({ userId: verifyResponse.data.user.id, email: verifyResponse.data.user.email, sessionId: verifyResponse.data.sessionId, expiresAt: verifyResponse.data.expiresAt });
        setupTokenRefresh();
        const intended = getIntendedUrl(); clearIntendedUrl(); navigate(intended || '/');
      } else {
        throw new Error(verifyResponse.error || 'CREDENTIAL_NOT_FOUND');
      }
    } catch (err) {
      const msg = mapPasskeyError(err);
      setError(msg);
      throw err;
    } finally { setIsLoading(false); }
  }, [navigate, setupTokenRefresh, getIntendedUrl, clearIntendedUrl, mapPasskeyError]);

  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const registerPasskey = useCallback(async (email?: string, displayName?: string) => {
    setError(null); setIsLoading(true);
    try {
      if (!window.PublicKeyCredential) throw new Error('Passkeys are not supported in this browser.');
      const normalized = (email || '').trim().toLowerCase();
      if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Please enter a valid email address.');

      const optionsResponse = await apiClient.getPasskeyRegOptions({ email: normalized, displayName });
      if (!optionsResponse.success || !optionsResponse.data) throw new Error(optionsResponse.error || 'Failed to get registration options');

      let regResponse: any;
      try {
        regResponse = await Promise.race([
          startRegistration({ optionsJSON: optionsResponse.data.options }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Registration timed out after 60 seconds')), TIMEOUT_MS))
        ]);
      } catch (e) {
        // transient retry once after small jitter for network issues only
        if (e instanceof Error && e.name === 'NetworkError') {
          await wait(400 + Math.floor(Math.random() * 400));
          regResponse = await Promise.race([
            startRegistration({ optionsJSON: optionsResponse.data.options }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Registration timed out after 60 seconds')), TIMEOUT_MS))
          ]);
        } else { throw e; }
      }

      const verifyResponse = await apiClient.verifyPasskeyReg({ credential: regResponse, challenge: optionsResponse.data.challenge, email: normalized, displayName });
      if (verifyResponse.success && verifyResponse.data) {
        setUser({ ...verifyResponse.data.user, isAnonymous: false } as AuthUser);
        setToken(null);
        setSession({ userId: verifyResponse.data.user.id, email: verifyResponse.data.user.email, sessionId: verifyResponse.data.sessionId, expiresAt: verifyResponse.data.expiresAt });
        setupTokenRefresh();
        const intended = getIntendedUrl(); clearIntendedUrl(); navigate(intended || '/');
      } else {
        throw new Error(verifyResponse.error || 'Registration failed');
      }
    } catch (err) {
      const msg = mapPasskeyError(err);
      setError(msg);
      throw err;
    } finally { setIsLoading(false); }
  }, [navigate, setupTokenRefresh, getIntendedUrl, clearIntendedUrl, mapPasskeyError]);

  const login = useCallback((provider: 'google' | 'github', redirectUrl?: string) => {
    const intendedUrl = redirectUrl || window.location.pathname + window.location.search; setIntendedUrl(intendedUrl);
    const oauthUrl = new URL(`/api/auth/oauth/${provider}`, window.location.origin); oauthUrl.searchParams.set('redirect_url', intendedUrl); window.location.href = oauthUrl.toString();
  }, [setIntendedUrl]);

  const loginWithEmail = useCallback(async (credentials: { email: string; password: string }) => {
    setError(null); setIsLoading(true);
    try { const response = await apiClient.loginWithEmail(credentials); if (response.success && response.data) { setUser({ ...response.data.user, isAnonymous: false } as AuthUser); setToken(null); setSession({ userId: response.data.user.id, email: response.data.user.email, sessionId: response.data.sessionId, expiresAt: response.data.expiresAt }); setupTokenRefresh(); const intended = getIntendedUrl(); clearIntendedUrl(); navigate(intended || '/'); } }
    catch (err) { if (err instanceof ApiError) setError(err.message); else setError('Connection error. Please try again.'); throw err; }
    finally { setIsLoading(false); }
  }, [navigate, setupTokenRefresh, getIntendedUrl, clearIntendedUrl]);

  const register = useCallback(async (data: { email: string; password: string; name?: string }) => {
    setError(null); setIsLoading(true);
    try { const response = await apiClient.register(data); if (response.success && response.data) { setUser({ ...response.data.user, isAnonymous: false } as AuthUser); setToken(null); setSession({ userId: response.data.user.id, email: response.data.user.email, sessionId: response.data.sessionId, expiresAt: response.data.expiresAt }); setupTokenRefresh(); const intended = getIntendedUrl(); clearIntendedUrl(); navigate(intended || '/'); } }
    catch (err) { if (err instanceof ApiError) setError(err.message); else setError('Connection error. Please try again.'); throw err; }
    finally { setIsLoading(false); }
  }, [navigate, setupTokenRefresh, getIntendedUrl, clearIntendedUrl]);

  const logout = useCallback(async () => { try { await apiClient.logout(); } catch {} finally { setUser(null); setToken(null); setSession(null); if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); navigate('/'); } }, [navigate]);
  const refreshUser = useCallback(async () => { await checkAuth(); }, [checkAuth]);
  const clearError = useCallback(() => { setError(null); }, []);

  const value: AuthContextType = { user, token, session, isAuthenticated: !!user, isLoading, error, authProviders, hasPasskey, hasOAuth, requiresEmailAuth, loginWithPasskey, registerPasskey, login, loginWithEmail, register, logout, refreshUser, clearError, setIntendedUrl, getIntendedUrl, clearIntendedUrl };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const context = useContext(AuthContext); if (context === undefined) { throw new Error('useAuth must be used within an AuthProvider'); } return context; }
export function useRequireAuth(redirectTo = '/') { const { isAuthenticated, isLoading } = useAuth(); const navigate = useNavigate(); useEffect(() => { if (!isLoading && !isAuthenticated) { navigate(redirectTo); } }, [isAuthenticated, isLoading, navigate, redirectTo]); return { isAuthenticated, isLoading }; }
