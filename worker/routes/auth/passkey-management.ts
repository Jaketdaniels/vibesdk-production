/**
 * Passkey Management Routes
 * CRUD operations for user passkey credentials
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createLogger } from '../../logger';

const logger = createLogger('PasskeyManagement');

interface CloudflareBindings {
  DB: D1Database;
}

type AppEnv = {
  Bindings: CloudflareBindings;
};

interface CredentialRecord {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  aaguid: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

// Validation schemas
const updateCredentialSchema = z.object({
  credentialId: z.string(),
  name: z.string().min(1).max(100).optional(),
});

const deleteCredentialSchema = z.object({
  credentialId: z.string(),
});

// NOTE: Helpers temporarily removed to satisfy noUnusedLocals until session wiring is added.
// When wiring auth, restore these helpers and use them in the handlers below.

const app = new Hono<AppEnv>();

// Get user's passkeys (temporarily returns 401 until session wiring is added)
app.get('/credentials', async (c) => {
  return c.json({ success: false, error: 'Authentication required' }, 401);
});

// Update passkey (rename) - temporarily returns 401
app.patch('/credentials', zValidator('json', updateCredentialSchema), async (c) => {
  return c.json({ success: false, error: 'Authentication required' }, 401);
});

// Delete passkey - temporarily returns 401
app.delete('/credentials', zValidator('json', deleteCredentialSchema), async (c) => {
  return c.json({ success: false, error: 'Authentication required' }, 401);
});

export default app;
