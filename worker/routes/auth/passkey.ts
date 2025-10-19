/**
 * Passkey Authentication Routes for Cloudflare Workers
 * Implements WebAuthn registration and authentication using SimpleWebAuthn v13
 */

import { Hono } from 'hono';
import {
	generateRegistrationOptions,
	generateAuthenticationOptions,
	verifyRegistrationResponse,
	verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
	GenerateRegistrationOptionsOpts,
	GenerateAuthenticationOptionsOpts,
	VerifyRegistrationResponseOpts,
	VerifyAuthenticationResponseOpts,
	AuthenticatorTransport,
} from '@simplewebauthn/server';
import { isoUint8Array, isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

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

interface SessionData {
	id: string;
	user_id: string;
	expires_at: string;
}

interface CreateUserData {
	id: string;
	email?: string;
	displayName?: string;
}

interface SaveCredentialData {
	userId: string;
	credentialId: string;
	publicKey: string;
	counter: number;
	transports?: string[];
	aaguid?: string;
}

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const registrationOptionsSchema = z.object({
	email: z.string().email().optional(),
	displayName: z.string().min(1).optional(),
});

const registrationVerificationSchema = z.object({
	credential: z.object({
		id: z.string(),
		rawId: z.string(),
		response: z.object({
			attestationObject: z.string(),
			clientDataJSON: z.string(),
			transports: z.array(z.string()).optional(),
		}),
		type: z.literal('public-key'),
		clientExtensionResults: z.record(z.any()).optional(),
		authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
	}),
	challenge: z.string(),
	email: z.string().email().optional(),
	displayName: z.string().optional(),
});

const authenticationVerificationSchema = z.object({
	credential: z.object({
		id: z.string(),
		rawId: z.string(),
		response: z.object({
			authenticatorData: z.string(),
			clientDataJSON: z.string(),
			signature: z.string(),
			userHandle: z.string().optional(),
		}),
		type: z.literal('public-key'),
		clientExtensionResults: z.record(z.any()).optional(),
		authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
	}),
	challenge: z.string(),
});

// =============================================================================
// CHALLENGE MANAGEMENT
// =============================================================================

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

function generateChallenge(): string {
	const randomBytes = new Uint8Array(32);
	crypto.getRandomValues(randomBytes);
	return btoa(String.fromCharCode(...randomBytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
}

function buildRegistrationChallengeKey(userId: string, challenge: string): string {
	return `reg:${userId}:${challenge}`;
}

function buildAuthenticationChallengeKey(challenge: string): string {
	return `auth:${challenge}`;
}

async function storeChallenge(
	env: CloudflareBindings,
	key: string,
	challenge: string,
	ttlSeconds: number = CHALLENGE_TTL_SECONDS
): Promise<void> {
	await env.WEBAUTHN_CHALLENGES.put(key, challenge, { expirationTtl: ttlSeconds });
}

async function retrieveChallenge(env: CloudflareBindings, key: string): Promise<string | null> {
	return await env.WEBAUTHN_CHALLENGES.get(key);
}

async function deleteChallenge(env: CloudflareBindings, key: string): Promise<void> {
	await env.WEBAUTHN_CHALLENGES.delete(key);
}

async function findRegistrationChallenge(
	env: CloudflareBindings,
	challenge: string
): Promise<{ storedChallenge: string; challengeKey: string; userId: string } | null> {
	const challengeKeys = await env.WEBAUTHN_CHALLENGES.list({ prefix: 'reg:' });

	for (const key of challengeKeys.keys) {
		const stored = await retrieveChallenge(env, key.name);
		if (stored === challenge) {
			const userId = key.name.split(':')[1];
			return {
				storedChallenge: stored,
				challengeKey: key.name,
				userId,
			};
		}
	}

	return null;
}

// =============================================================================
// DATABASE OPERATIONS - USERS
// =============================================================================

async function findUserByEmail(env: CloudflareBindings, email: string): Promise<UserRecord | null> {
	const result = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
	return result as UserRecord | null;
}

async function findUserById(env: CloudflareBindings, id: string): Promise<UserRecord | null> {
	const result = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
	return result as UserRecord | null;
}

async function insertUser(env: CloudflareBindings, data: CreateUserData): Promise<UserRecord | null> {
	const result = await env.DB.prepare(`
		INSERT INTO users (id, email, name, display_name, created_at, updated_at)
		VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
		RETURNING *
	`)
		.bind(data.id, data.email || null, data.displayName || null, data.displayName || null)
		.first();
	return result as UserRecord | null;
}

// =============================================================================
// DATABASE OPERATIONS - CREDENTIALS
// =============================================================================

async function findCredentialsByUserId(env: CloudflareBindings, userId: string): Promise<CredentialRecord[]> {
	const results = await env.DB.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ?')
		.bind(userId)
		.all();
	return results.results as CredentialRecord[];
}

async function findCredentialById(
	env: CloudflareBindings,
	credentialId: string
): Promise<CredentialRecord | null> {
	const result = await env.DB.prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?')
		.bind(credentialId)
		.first();
	return result as CredentialRecord | null;
}

async function insertCredential(env: CloudflareBindings, data: SaveCredentialData): Promise<void> {
	await env.DB.prepare(`
		INSERT INTO webauthn_credentials
		(user_id, credential_id, public_key, counter, transports, aaguid, created_at)
		VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
	`)
		.bind(
			data.userId,
			data.credentialId,
			data.publicKey,
			data.counter,
			data.transports ? JSON.stringify(data.transports) : null,
			data.aaguid || null
		)
		.run();
}

async function updateCredentialCounter(
	env: CloudflareBindings,
	credentialId: string,
	counter: number
): Promise<void> {
	await env.DB.prepare('UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?')
		.bind(counter, credentialId)
		.run();
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

const SESSION_DURATION_HOURS = 24;

function generateSessionId(): string {
	return crypto.randomUUID();
}

function generateUserId(): string {
	return crypto.randomUUID();
}

function calculateSessionExpiry(): Date {
	return new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
}

async function createSession(env: CloudflareBindings, userId: string): Promise<SessionData> {
	const sessionId = generateSessionId();
	const expiresAt = calculateSessionExpiry();

	return {
		id: sessionId,
		user_id: userId,
		expires_at: expiresAt.toISOString(),
	};
}

function buildSessionCookie(sessionId: string, expiresAt: string): string {
	const expires = new Date(expiresAt);
	return `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}`;
}

// =============================================================================
// CREDENTIAL HELPERS
// =============================================================================

async function buildExcludedCredentials(
	env: CloudflareBindings,
	userId: string
): Promise<{ id: Uint8Array; type: 'public-key'; transports?: AuthenticatorTransport[] }[]> {
	const credentials = await findCredentialsByUserId(env, userId);
	return credentials.map((cred) => ({
		id: isoBase64URL.toBuffer(cred.credential_id),
		type: 'public-key' as const,
		transports: cred.transports ? (JSON.parse(cred.transports) as AuthenticatorTransport[]) : undefined,
	}));
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

const app = new Hono<AppEnv>();

// Registration: Generate options
app.post('/register/options', zValidator('json', registrationOptionsSchema), async (c) => {
	try {
		const { email, displayName } = c.req.valid('json');
		const env = c.env;

		let userId = generateUserId();
		let user: UserRecord | null = null;

		if (email) {
			user = await findUserByEmail(env, email);
			if (user) {
				userId = user.id;
			}
		}

		const challenge = generateChallenge();
		const challengeKey = buildRegistrationChallengeKey(userId, challenge);
		await storeChallenge(env, challengeKey, challenge);

		const excludeCredentials = user ? await buildExcludedCredentials(env, userId) : [];

		const options = await generateRegistrationOptions({
			rpName: env.RP_NAME,
			rpID: env.RP_ID,
			userID: isoUint8Array.fromUTF8String(userId),
			userName: email || `user_${userId}`,
			userDisplayName: displayName || email || `User ${userId}`,
			challenge: isoUint8Array.fromUTF8String(challenge),
			attestationType: 'none',
			excludeCredentials,
			authenticatorSelection: {
				residentKey: 'preferred',
				userVerification: 'preferred',
				authenticatorAttachment: 'platform',
			},
			supportedAlgorithmIDs: [-7, -257], // ES256, RS256
		});

		return c.json({
			success: true,
			data: {
				options,
				challenge,
				userId,
			},
		});
	} catch (error) {
		console.error('Registration options error:', error);
		return c.json(
			{
				success: false,
				error: 'Failed to generate registration options',
			},
			500
		);
	}
});

// Registration: Verify credential
app.post('/register/verify', zValidator('json', registrationVerificationSchema), async (c) => {
	try {
		const { credential, challenge, email, displayName } = c.req.valid('json');
		const env = c.env;

		const challengeData = await findRegistrationChallenge(env, challenge);
		if (!challengeData) {
			return c.json(
				{
					success: false,
					error: 'Invalid or expired challenge',
				},
				400
			);
		}

		const { storedChallenge, challengeKey, userId } = challengeData;

		const verification = await verifyRegistrationResponse({
			response: credential,
			expectedChallenge: storedChallenge,
			expectedOrigin: env.ORIGIN,
			expectedRPID: env.RP_ID,
			requireUserVerification: false,
		});

		if (!verification.verified || !verification.registrationInfo) {
			await deleteChallenge(env, challengeKey);
			return c.json(
				{
					success: false,
					error: 'Registration verification failed',
				},
				400
			);
		}

		await deleteChallenge(env, challengeKey);

		const { credentialPublicKey, credentialID, counter, aaguid } = verification.registrationInfo;

		let user = await findUserById(env, userId);
		if (!user) {
			user = await insertUser(env, { id: userId, email, displayName });
		}

		if (!user) {
			return c.json(
				{
					success: false,
					error: 'Failed to create user',
				},
				500
			);
		}

		await insertCredential(env, {
			userId: user.id,
			credentialId: isoBase64URL.fromBuffer(credentialID),
			publicKey: isoBase64URL.fromBuffer(credentialPublicKey),
			counter,
			transports: credential.response.transports,
			aaguid: aaguid ? isoBase64URL.fromBuffer(aaguid) : undefined,
		});

		const session = await createSession(env, user.id);
		const sessionCookie = buildSessionCookie(session.id, session.expires_at);

		return c.json(
			{
				success: true,
				data: {
					user: {
						id: user.id,
						email: user.email,
						name: user.name,
						displayName: user.display_name,
						createdAt: user.created_at,
					},
					sessionId: session.id,
					expiresAt: new Date(session.expires_at),
				},
			},
			200,
			{
				'Set-Cookie': sessionCookie,
			}
		);
	} catch (error) {
		console.error('Registration verification error:', error);
		return c.json(
			{
				success: false,
				error: 'Registration verification failed',
			},
			500
		);
	}
});

// Authentication: Generate options
app.post('/auth/options', async (c) => {
	try {
		const env = c.env;

		const challenge = generateChallenge();
		const challengeKey = buildAuthenticationChallengeKey(challenge);
		await storeChallenge(env, challengeKey, challenge);

		const options = await generateAuthenticationOptions({
			rpID: env.RP_ID,
			challenge: isoUint8Array.fromUTF8String(challenge),
			userVerification: 'preferred',
		});

		return c.json({
			success: true,
			data: {
				options,
				challenge,
			},
		});
	} catch (error) {
		console.error('Authentication options error:', error);
		return c.json(
			{
				success: false,
				error: 'Failed to generate authentication options',
			},
			500
		);
	}
});

// Authentication: Verify assertion
app.post('/auth/verify', zValidator('json', authenticationVerificationSchema), async (c) => {
	try {
		const { credential, challenge } = c.req.valid('json');
		const env = c.env;

		const challengeKey = buildAuthenticationChallengeKey(challenge);
		const storedChallenge = await retrieveChallenge(env, challengeKey);

		if (!storedChallenge || storedChallenge !== challenge) {
			return c.json(
				{
					success: false,
					error: 'Invalid or expired challenge',
				},
				400
			);
		}

		const credentialRecord = await findCredentialById(env, credential.id);
		if (!credentialRecord) {
			await deleteChallenge(env, challengeKey);
			return c.json(
				{
					success: false,
					error: 'Credential not found',
				},
				400
			);
		}

		const user = await findUserById(env, credentialRecord.user_id);
		if (!user) {
			await deleteChallenge(env, challengeKey);
			return c.json(
				{
					success: false,
					error: 'User not found',
				},
				400
			);
		}

		const verification = await verifyAuthenticationResponse({
			response: credential,
			expectedChallenge: storedChallenge,
			expectedOrigin: env.ORIGIN,
			expectedRPID: env.RP_ID,
			authenticator: {
				credentialID: isoBase64URL.toBuffer(credentialRecord.credential_id),
				credentialPublicKey: isoBase64URL.toBuffer(credentialRecord.public_key),
				counter: credentialRecord.counter,
				transports: credentialRecord.transports
					? (JSON.parse(credentialRecord.transports) as AuthenticatorTransport[])
					: undefined,
			},
			requireUserVerification: false,
		});

		if (!verification.verified) {
			await deleteChallenge(env, challengeKey);
			return c.json(
				{
					success: false,
					error: 'Authentication verification failed',
				},
				400
			);
		}

		await deleteChallenge(env, challengeKey);
		await updateCredentialCounter(env, credentialRecord.credential_id, verification.authenticationInfo.newCounter);

		const session = await createSession(env, user.id);
		const sessionCookie = buildSessionCookie(session.id, session.expires_at);

		return c.json(
			{
				success: true,
				data: {
					user: {
						id: user.id,
						email: user.email,
						name: user.name,
						displayName: user.display_name,
						createdAt: user.created_at,
					},
					sessionId: session.id,
					expiresAt: new Date(session.expires_at),
				},
			},
			200,
			{
				'Set-Cookie': sessionCookie,
			}
		);
	} catch (error) {
		console.error('Authentication verification error:', error);
		return c.json(
			{
				success: false,
				error: 'Authentication verification failed',
			},
			500
		);
	}
});

export default app;
