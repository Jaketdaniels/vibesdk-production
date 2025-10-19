/**
 * Passkey Authentication Routes for Cloudflare Workers
 * Implements WebAuthn registration and authentication using SimpleWebAuthn
 */

import { Hono } from 'hono';
import { 
  generateRegistrationOptions, 
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import type {
  GenerateRegistrationOptionsOpts,
  GenerateAuthenticationOptionsOpts,
  VerifyRegistrationResponseOpts,
  VerifyAuthenticationResponseOpts,
  AuthenticatorTransport
} from '@simplewebauthn/server';
import { isoUint8Array, isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// Generic types for Cloudflare bindings (will be replaced by proper Env type after wrangler types)
interface CloudflareBindings {
  DB: D1Database;
  WEBAUTHN_CHALLENGES: KVNamespace;
  RP_ID: string;
  RP_NAME: string;
  ORIGIN: string;
}

type AppEnv = {
  Bindings: CloudflareBindings;
};

const app = new Hono<AppEnv>();

// Database record types
interface UserRecord {
  id: string;
  email: string | null;
  name: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface CredentialRecord {
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  aaguid: string | null;
  created_at: string;
}

// Schema validators
const registrationOptionsSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional()
});

const registrationVerificationSchema = z.object({
  credential: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      attestationObject: z.string(),
      clientDataJSON: z.string(),
      transports: z.array(z.string()).optional()
    }),
    type: z.literal('public-key'),
    clientExtensionResults: z.record(z.any()).optional(),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional()
  }),
  challenge: z.string(),
  email: z.string().email().optional(),
  displayName: z.string().optional()
});

const authenticationVerificationSchema = z.object({
  credential: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      authenticatorData: z.string(),
      clientDataJSON: z.string(),
      signature: z.string(),
      userHandle: z.string().optional()
    }),
    type: z.literal('public-key'),
    clientExtensionResults: z.record(z.any()).optional(),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional()
  }),
  challenge: z.string()
});

// Helper functions
function generateUserId(): string {
  return crypto.randomUUID();
}

function generateChallenge(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function storeChallenge(env: CloudflareBindings, key: string, challenge: string, ttl = 300) {
  await env.WEBAUTHN_CHALLENGES.put(key, challenge, { expirationTtl: ttl });
}

async function getChallenge(env: CloudflareBindings, key: string): Promise<string | null> {
  return await env.WEBAUTHN_CHALLENGES.get(key);
}

async function deleteChallenge(env: CloudflareBindings, key: string) {
  await env.WEBAUTHN_CHALLENGES.delete(key);
}

// Database helpers
async function getUserByEmail(env: CloudflareBindings, email: string): Promise<UserRecord | null> {
  const result = await env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first();
  return result as UserRecord | null;
}

async function getUserById(env: CloudflareBindings, id: string): Promise<UserRecord | null> {
  const result = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(id).first();
  return result as UserRecord | null;
}

async function createUser(env: CloudflareBindings, data: { id: string; email?: string; displayName?: string }): Promise<UserRecord | null> {
  const result = await env.DB.prepare(`
    INSERT INTO users (id, email, name, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    RETURNING *
  `).bind(
    data.id,
    data.email || null,
    data.displayName || null,
    data.displayName || null
  ).first();
  return result as UserRecord | null;
}

async function getCredentialsByUserId(env: CloudflareBindings, userId: string) {
  const results = await env.DB.prepare(
    'SELECT * FROM webauthn_credentials WHERE user_id = ?'
  ).bind(userId).all();
  return results.results;
}

async function getCredentialById(env: CloudflareBindings, credentialId: string): Promise<CredentialRecord | null> {
  const result = await env.DB.prepare(
    'SELECT * FROM webauthn_credentials WHERE credential_id = ?'
  ).bind(credentialId).first();
  return result as CredentialRecord | null;
}

async function saveCredential(env: CloudflareBindings, data: {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  aaguid?: string;
}) {
  await env.DB.prepare(`
    INSERT INTO webauthn_credentials 
    (user_id, credential_id, public_key, counter, transports, aaguid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    data.userId,
    data.credentialId,
    data.publicKey,
    data.counter,
    data.transports ? JSON.stringify(data.transports) : null,
    data.aaguid || null
  ).run();
}

async function updateCredentialCounter(env: CloudflareBindings, credentialId: string, counter: number) {
  await env.DB.prepare(
    'UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?'
  ).bind(counter, credentialId).run();
}

// Session helpers - simplified versions that should match your existing session system
async function createSession(env: CloudflareBindings, userId: string) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  // This should match your existing session creation logic
  // For now, returning a simple object - you may need to adjust this
  return {
    id: sessionId,
    user_id: userId,
    expires_at: expiresAt.toISOString()
  };
}

function getSessionCookie(sessionId: string, expiresAt: string): string {
  // This should match your existing session cookie logic
  // Basic cookie format - you may need to adjust this
  const expires = new Date(expiresAt);
  return `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}`;
}

// Registration endpoints
app.post('/register/options', zValidator('json', registrationOptionsSchema), async (c) => {
  try {
    const { email, displayName } = c.req.valid('json');
    const env = c.env;

    // Generate user ID (will be used for new user or existing user)
    let userId = generateUserId();
    let user = null;

    // If email provided, check if user exists
    if (email) {
      user = await getUserByEmail(env, email);
      if (user) {
        userId = user.id;
      }
    }

    // Generate challenge
    const challenge = generateChallenge();
    const challengeKey = `reg:${userId}:${challenge}`;

    // Store challenge with TTL
    await storeChallenge(env, challengeKey, challenge, 300); // 5 minutes

    // Generate registration options
    const options = await generateRegistrationOptions({
      rpName: env.RP_NAME,
      rpID: env.RP_ID,
      userID: isoUint8Array.fromUTF8String(userId),
      userName: email || `user_${userId}`,
      userDisplayName: displayName || email || `User ${userId}`,
      challenge: isoUint8Array.fromUTF8String(challenge),
      attestationType: 'none',
      // Exclude existing credentials for this user
      excludeCredentials: user ? (await getCredentialsByUserId(env, userId)).map((cred: any) => ({
        id: isoUint8Array.fromBase64URL(cred.credential_id),
        type: 'public-key',
        transports: cred.transports ? JSON.parse(cred.transports) : undefined
      })) : [],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform'
      },
      supportedAlgorithmIDs: [-7, -257] // ES256, RS256
    });

    return c.json({
      success: true,
      data: {
        options,
        challenge,
        userId
      }
    });
  } catch (error) {
    console.error('Registration options error:', error);
    return c.json({
      success: false,
      error: 'Failed to generate registration options'
    }, 500);
  }
});

app.post('/register/verify', zValidator('json', registrationVerificationSchema), async (c) => {
  try {
    const { credential, challenge, email, displayName } = c.req.valid('json');
    const env = c.env;

    // Find stored challenge
    const challengeKeys = await env.WEBAUTHN_CHALLENGES.list({ prefix: `reg:` });
    let storedChallenge = null;
    let challengeKey = null;
    let userId = null;

    for (const key of challengeKeys.keys) {
      const stored = await getChallenge(env, key.name);
      if (stored === challenge) {
        storedChallenge = stored;
        challengeKey = key.name;
        userId = key.name.split(':')[1]; // Extract userId from reg:userId:challenge
        break;
      }
    }

    if (!storedChallenge || !userId) {
      return c.json({
        success: false,
        error: 'Invalid or expired challenge'
      }, 400);
    }

    // Verify registration
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: storedChallenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: false
    });

    if (!verification.verified || !verification.registrationInfo) {
      await deleteChallenge(env, challengeKey);
      return c.json({
        success: false,
        error: 'Registration verification failed'
      }, 400);
    }

    // Clean up challenge
    await deleteChallenge(env, challengeKey);

    const { credentialPublicKey, credentialID, counter, aaguid } = verification.registrationInfo;

    // Create or get user
    let user = await getUserById(env, userId);
    if (!user) {
      user = await createUser(env, {
        id: userId,
        email,
        displayName
      });
    }

    if (!user) {
      return c.json({
        success: false,
        error: 'Failed to create user'
      }, 500);
    }

    // Save credential
    await saveCredential(env, {
      userId: user.id as string,
      credentialId: isoBase64URL.fromBuffer(credentialID),
      publicKey: isoBase64URL.fromBuffer(credentialPublicKey),
      counter,
      transports: credential.response.transports,
      aaguid: aaguid ? isoBase64URL.fromBuffer(aaguid) : undefined
    });

    // Create session
    const session = await createSession(env, user.id as string);
    const sessionCookie = getSessionCookie(session.id, session.expires_at);

    return c.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          displayName: user.display_name,
          createdAt: user.created_at
        },
        sessionId: session.id,
        expiresAt: new Date(session.expires_at)
      }
    }, 200, {
      'Set-Cookie': sessionCookie
    });
  } catch (error) {
    console.error('Registration verification error:', error);
    return c.json({
      success: false,
      error: 'Registration verification failed'
    }, 500);
  }
});

// Authentication endpoints
app.post('/auth/options', async (c) => {
  try {
    const env = c.env;

    // Generate challenge
    const challenge = generateChallenge();
    const challengeKey = `auth:${challenge}`;

    // Store challenge with TTL
    await storeChallenge(env, challengeKey, challenge, 300); // 5 minutes

    // Generate authentication options
    const options = await generateAuthenticationOptions({
      rpID: env.RP_ID,
      challenge: isoUint8Array.fromUTF8String(challenge),
      userVerification: 'preferred'
      // Note: not specifying allowCredentials to allow platform to choose
    });

    return c.json({
      success: true,
      data: {
        options,
        challenge
      }
    });
  } catch (error) {
    console.error('Authentication options error:', error);
    return c.json({
      success: false,
      error: 'Failed to generate authentication options'
    }, 500);
  }
});

app.post('/auth/verify', zValidator('json', authenticationVerificationSchema), async (c) => {
  try {
    const { credential, challenge } = c.req.valid('json');
    const env = c.env;

    // Find and verify stored challenge
    const challengeKey = `auth:${challenge}`;
    const storedChallenge = await getChallenge(env, challengeKey);

    if (!storedChallenge || storedChallenge !== challenge) {
      return c.json({
        success: false,
        error: 'Invalid or expired challenge'
      }, 400);
    }

    // Get credential from database
    const credentialRecord = await getCredentialById(env, credential.id);
    if (!credentialRecord) {
      await deleteChallenge(env, challengeKey);
      return c.json({
        success: false,
        error: 'Credential not found'
      }, 400);
    }

    // Get user
    const user = await getUserById(env, credentialRecord.user_id);
    if (!user) {
      await deleteChallenge(env, challengeKey);
      return c.json({
        success: false,
        error: 'User not found'
      }, 400);
    }

    // Verify authentication
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: storedChallenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      authenticator: {
        credentialID: isoBase64URL.toBuffer(credentialRecord.credential_id),
        credentialPublicKey: isoBase64URL.toBuffer(credentialRecord.public_key),
        counter: credentialRecord.counter,
        transports: credentialRecord.transports ? JSON.parse(credentialRecord.transports) as AuthenticatorTransport[] : undefined
      },
      requireUserVerification: false
    });

    if (!verification.verified) {
      await deleteChallenge(env, challengeKey);
      return c.json({
        success: false,
        error: 'Authentication verification failed'
      }, 400);
    }

    // Clean up challenge
    await deleteChallenge(env, challengeKey);

    // Update credential counter
    await updateCredentialCounter(env, credentialRecord.credential_id as string, verification.authenticationInfo.newCounter);

    // Create session
    const session = await createSession(env, user.id as string);
    const sessionCookie = getSessionCookie(session.id, session.expires_at);

    return c.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          displayName: user.display_name,
          createdAt: user.created_at
        },
        sessionId: session.id,
        expiresAt: new Date(session.expires_at)
      }
    }, 200, {
      'Set-Cookie': sessionCookie
    });
  } catch (error) {
    console.error('Authentication verification error:', error);
    return c.json({
      success: false,
      error: 'Authentication verification failed'
    }, 500);
  }
});

export default app;