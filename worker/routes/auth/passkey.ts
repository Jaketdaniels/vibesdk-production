/**
 * Passkey Authentication Routes (fix challenge structure + CSRF-friendly)
 */

import { Hono } from 'hono';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransport, RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { isoUint8Array, isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createLogger } from '../../logger';

const logger = createLogger('PasskeyAuth');

type AppEnv = { Bindings: Env };

interface UserRecord { id: string; email: string | null; name: string | null; display_name: string | null; created_at: string; updated_at: string; }
interface CredentialRecord { user_id: string; credential_id: string; public_key: string; counter: number; transports: string | null; aaguid: string | null; created_at: string; }
interface SessionData { id: string; user_id: string; expires_at: string; }

const regOptionsSchema = z.object({ email: z.string().email() });
const regVerifySchema = z.object({
  credential: z.object({ id: z.string(), rawId: z.string(), response: z.object({ attestationObject: z.string(), clientDataJSON: z.string(), transports: z.array(z.enum(['ble','cable','hybrid','internal','nfc','smart-card','usb'])).optional(), }), type: z.literal('public-key'), clientExtensionResults: z.object({}).passthrough().optional(), authenticatorAttachment: z.enum(['platform','cross-platform']).optional(), }) as z.ZodType<RegistrationResponseJSON>,
  challenge: z.string(), email: z.string().email(),
});
const authVerifySchema = z.object({
  credential: z.object({ id: z.string(), rawId: z.string(), response: z.object({ authenticatorData: z.string(), clientDataJSON: z.string(), signature: z.string(), userHandle: z.string().optional(), }), type: z.literal('public-key'), clientExtensionResults: z.object({}).passthrough().optional(), authenticatorAttachment: z.enum(['platform','cross-platform']).optional(), }) as z.ZodType<AuthenticationResponseJSON>,
  challenge: z.string(),
});

const CHALLENGE_TTL_SECONDS = 300;

function randomBytes(size = 32): Uint8Array { const b = new Uint8Array(size); crypto.getRandomValues(b); return b; }
function regKey(ch: string): string { return `reg:${ch}`; }
function authKey(ch: string): string { return `auth:${ch}`; }
async function kvPut(kv: KVNamespace, key: string, value: string, ttl = CHALLENGE_TTL_SECONDS) { await kv.put(key, value, { expirationTtl: ttl }); }
async function kvGet(kv: KVNamespace, key: string) { return kv.get(key); }
async function kvDel(kv: KVNamespace, key: string) { await kv.delete(key); }

async function findUserByEmail(env: Env, email: string): Promise<UserRecord | null> { const r = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first(); return r as UserRecord | null; }
async function findUserById(env: Env, id: string): Promise<UserRecord | null> { const r = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first(); return r as UserRecord | null; }
async function insertUser(env: Env, id: string, email: string): Promise<UserRecord | null> { const r = await env.DB.prepare(`INSERT INTO users (id, email, name, display_name, created_at, updated_at) VALUES (?, ?, NULL, NULL, datetime('now'), datetime('now')) RETURNING *`).bind(id, email).first(); return r as UserRecord | null; }

async function credsByUser(env: Env, userId: string): Promise<CredentialRecord[]> { const rs = await env.DB.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ?').bind(userId).all<CredentialRecord>(); return rs.results ?? []; }
async function credById(env: Env, id: string): Promise<CredentialRecord | null> { const r = await env.DB.prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?').bind(id).first(); return r as CredentialRecord | null; }
async function insertCred(env: Env, d: { userId: string; id: string; publicKey: string; counter: number; transports?: string[]; aaguid?: string; }) { await env.DB.prepare(`INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, aaguid, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).bind(d.userId, d.id, d.publicKey, d.counter, d.transports ? JSON.stringify(d.transports) : null, d.aaguid || null).run(); }
async function updateCounter(env: Env, id: string, c: number) { await env.DB.prepare(`UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime('now') WHERE credential_id = ?`).bind(c, id).run(); }

async function createSession(env: Env, userId: string): Promise<SessionData> { const id = crypto.randomUUID(); const exp = new Date(Date.now() + 24 * 60 * 60 * 1000); await env.DB.prepare(`INSERT INTO sessions (id, user_id, access_token_hash, refresh_token_hash, expires_at, created_at, device_info, is_revoked) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 0)`).bind(id, userId, '', '', Math.floor(exp.getTime()/1000), 'passkey').run(); return { id, user_id: userId, expires_at: exp.toISOString() }; }
function cookie(sessionId: string, expiresAt: string): string { const exp = new Date(expiresAt); return `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${exp.toUTCString()}`; }

const app = new Hono<AppEnv>();

app.post('/register/options', zValidator('json', regOptionsSchema), async (c) => {
  try {
    const env = c.env as unknown as Env;
    const email = c.req.valid('json').email.trim().toLowerCase();

    let user = await findUserByEmail(env, email);
    let userId = user?.id ?? crypto.randomUUID();

    // Create raw binary challenge for options and a b64url-encoded copy for verify payload
    const challengeBytes = randomBytes(32);
    const challengeB64 = isoBase64URL.fromBuffer(challengeBytes);

    await kvPut(env.WEBAUTHN_CHALLENGES, regKey(challengeB64), JSON.stringify({ userId, challenge: challengeB64 }));

    const excludeCredentials = user ? (await credsByUser(env, userId)).map((cr) => ({ id: cr.credential_id })) : [];

    const options = await generateRegistrationOptions({
      rpName: env.RP_NAME,
      rpID: env.RP_ID,
      userID: isoUint8Array.fromUTF8String(userId),
      userName: email,
      userDisplayName: email,
      challenge: challengeBytes, // raw bytes as expected by simplewebauthn
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      excludeCredentials,
      supportedAlgorithmIDs: [-7, -257],
    });

    return c.json({ success: true, data: { options, challenge: challengeB64, userId } });
  } catch (e) { logger.error('reg/options', e); return c.json({ success: false, error: 'Failed to generate registration options' }, 500); }
});

app.post('/register/verify', zValidator('json', regVerifySchema), async (c) => {
  try {
    const env = c.env as unknown as Env;
    const { credential, challenge, email } = c.req.valid('json');

    const regData = await kvGet(env.WEBAUTHN_CHALLENGES, regKey(challenge));
    if (!regData) return c.json({ success: false, error: 'Invalid or expired challenge', code: 'CHALLENGE_EXPIRED' }, 400);
    const { userId, challenge: storedChallenge } = JSON.parse(regData);

    const vr = await verifyRegistrationResponse({ response: credential, expectedChallenge: storedChallenge, expectedOrigin: env.ORIGIN, expectedRPID: env.RP_ID, requireUserVerification: false });
    if (!vr.verified || !vr.registrationInfo) { await kvDel(env.WEBAUTHN_CHALLENGES, regKey(challenge)); return c.json({ success: false, error: 'Passkey registration verification failed', code: 'VERIFICATION_FAILED' }, 400); }

    await kvDel(env.WEBAUTHN_CHALLENGES, regKey(challenge));

    let user = await findUserById(env, userId);
    if (!user) user = await insertUser(env, userId, email);
    if (!user) return c.json({ success: false, error: 'Failed to create user account', code: 'USER_CREATION_FAILED' }, 500);

    const { credential: cr, aaguid } = vr.registrationInfo;
    await insertCred(env, { userId: user.id, id: cr.id, publicKey: isoBase64URL.fromBuffer(cr.publicKey), counter: cr.counter, transports: credential.response.transports, aaguid });

    const sess = await createSession(env, user.id);
    return c.json({ success: true, data: { user: { id: user.id, email: user.email, displayName: user.display_name }, sessionId: sess.id, expiresAt: new Date(sess.expires_at) } }, 200, { 'Set-Cookie': cookie(sess.id, sess.expires_at) });
  } catch (e) { logger.error('reg/verify', e); return c.json({ success: false, error: 'Registration verification failed', code: 'INTERNAL_ERROR' }, 500); }
});

app.post('/auth/options', async (c) => {
  try {
    const env = c.env as unknown as Env;
    const challengeBytes = randomBytes(32);
    const challengeB64 = isoBase64URL.fromBuffer(challengeBytes);

    await kvPut(env.WEBAUTHN_CHALLENGES, authKey(challengeB64), challengeB64);

    const options = await generateAuthenticationOptions({ rpID: env.RP_ID, challenge: challengeBytes, userVerification: 'preferred' });

    return c.json({ success: true, data: { options, challenge: challengeB64 } });
  } catch (e) { logger.error('auth/options', e); return c.json({ success: false, error: 'Failed to generate authentication options' }, 500); }
});

app.post('/auth/verify', zValidator('json', authVerifySchema), async (c) => {
  try {
    const env = c.env as unknown as Env;
    const { credential, challenge } = c.req.valid('json');

    const stored = await kvGet(env.WEBAUTHN_CHALLENGES, authKey(challenge));
    if (!stored || stored !== challenge) return c.json({ success: false, error: 'Invalid or expired challenge', code: 'CHALLENGE_EXPIRED' }, 400);

    const rec = await credById(env, credential.id);
    if (!rec) { await kvDel(env.WEBAUTHN_CHALLENGES, authKey(challenge)); return c.json({ success: false, error: 'Passkey not recognized', code: 'CREDENTIAL_NOT_FOUND' }, 400); }

    const user = await findUserById(env, rec.user_id);
    if (!user) { await kvDel(env.WEBAUTHN_CHALLENGES, authKey(challenge)); return c.json({ success: false, error: 'User account not found', code: 'USER_NOT_FOUND' }, 400); }

    const vr = await verifyAuthenticationResponse({ response: credential, expectedChallenge: stored, expectedOrigin: env.ORIGIN, expectedRPID: env.RP_ID, credential: { id: rec.credential_id, publicKey: isoBase64URL.toBuffer(rec.public_key), counter: rec.counter, transports: rec.transports ? (JSON.parse(rec.transports) as AuthenticatorTransport[]) : undefined, }, requireUserVerification: false });

    if (!vr.verified) { await kvDel(env.WEBAUTHN_CHALLENGES, authKey(challenge)); return c.json({ success: false, error: 'Passkey authentication failed', code: 'VERIFICATION_FAILED' }, 400); }

    await kvDel(env.WEBAUTHN_CHALLENGES, authKey(challenge));
    const newCounter = Math.max(rec.counter, vr.authenticationInfo.newCounter);
    await updateCounter(env, rec.credential_id, newCounter);

    const sess = await createSession(env, user.id);
    return c.json({ success: true, data: { user: { id: user.id, email: user.email, displayName: user.display_name }, sessionId: sess.id, expiresAt: new Date(sess.expires_at) } }, 200, { 'Set-Cookie': cookie(sess.id, sess.expires_at) });
  } catch (e) { logger.error('auth/verify', e); return c.json({ success: false, error: 'Authentication verification failed', code: 'INTERNAL_ERROR' }, 500); }
});

export default app;
