/**
 * Passkey Management Routes
 * CRUD operations for user passkey credentials
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createLogger } from '../../logger';
import { authMiddleware } from '../../middleware/auth/auth';
import type { AppEnv } from '../../types/appenv';

const logger = createLogger('PasskeyManagement');

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

// Database operations
async function getUserCredentials(env: Env, userId: string): Promise<CredentialRecord[]> {
  const results = await env.DB.prepare(`
    SELECT 
      id,
      user_id,
      credential_id,
      public_key,
      counter,
      transports,
      aaguid,
      name,
      created_at,
      last_used_at
    FROM webauthn_credentials 
    WHERE user_id = ? 
    ORDER BY created_at DESC
  `)
    .bind(userId)
    .all<CredentialRecord>();
  
  return results.results ?? [];
}

async function updateCredentialName(
  env: Env,
  userId: string,
  credentialId: string,
  name: string
): Promise<boolean> {
  const result = await env.DB.prepare(`
    UPDATE webauthn_credentials 
    SET name = ?, updated_at = datetime('now')
    WHERE user_id = ? AND credential_id = ?
  `)
    .bind(name, userId, credentialId)
    .run();
  
  return (result as any)?.meta?.changes > 0;
}

async function deleteCredential(
  env: Env,
  userId: string,
  credentialId: string
): Promise<boolean> {
  const result = await env.DB.prepare(`
    DELETE FROM webauthn_credentials 
    WHERE user_id = ? AND credential_id = ?
  `)
    .bind(userId, credentialId)
    .run();
  
  return (result as any)?.meta?.changes > 0;
}

async function countUserCredentials(env: Env, userId: string): Promise<number> {
  const result = await env.DB.prepare(`
    SELECT COUNT(*) as count
    FROM webauthn_credentials 
    WHERE user_id = ?
  `)
    .bind(userId)
    .first<{ count: number }>();
  
  return result?.count ?? 0;
}

const app = new Hono<AppEnv>();

// Get user's passkeys
app.get('/credentials', async (c) => {
  try {
    const userSession = await authMiddleware(c.req.raw, c.env);
    if (!userSession) {
      return c.json(
        {
          success: false,
          error: 'Authentication required',
        },
        401
      );
    }

    const credentials = await getUserCredentials(c.env, userSession.user.id);
    
    // Format the response to include friendly data
    const formattedCredentials = credentials.map(cred => ({
      id: cred.id,
      credentialId: cred.credential_id,
      name: cred.name,
      aaguid: cred.aaguid,
      createdAt: cred.created_at,
      lastUsedAt: cred.last_used_at,
      transports: cred.transports ? (JSON.parse(cred.transports) as string[]) : null,
    }));

    logger.info('Retrieved user credentials', {
      userId: userSession.user.id,
      credentialCount: credentials.length,
    });

    return c.json({
      success: true,
      data: {
        credentials: formattedCredentials,
        total: credentials.length,
      },
    });
  } catch (error) {
    logger.error('Failed to retrieve credentials', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    return c.json(
      {
        success: false,
        error: 'Failed to retrieve passkeys',
      },
      500
    );
  }
});

// Update passkey (rename)
app.patch('/credentials', zValidator('json', updateCredentialSchema), async (c) => {
  try {
    const userSession = await authMiddleware(c.req.raw, c.env);
    if (!userSession) {
      return c.json(
        {
          success: false,
          error: 'Authentication required',
        },
        401
      );
    }

    const { credentialId, name } = c.req.valid('json');
    
    if (name) {
      const updated = await updateCredentialName(c.env, userSession.user.id, credentialId, name);
      
      if (!updated) {
        return c.json(
          {
            success: false,
            error: 'Passkey not found or unauthorized',
          },
          404
        );
      }

      logger.info('Credential renamed', {
        userId: userSession.user.id,
        credentialId,
        newName: name,
      });
    }

    return c.json({
      success: true,
      message: 'Passkey updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update credential', {
      error: error instanceof Error ? error.message : String(error),
      credentialId: c.req.valid('json').credentialId,
    });
    
    return c.json(
      {
        success: false,
        error: 'Failed to update passkey',
      },
      500
    );
  }
});

// Delete passkey
app.delete('/credentials', zValidator('json', deleteCredentialSchema), async (c) => {
  try {
    const userSession = await authMiddleware(c.req.raw, c.env);
    if (!userSession) {
      return c.json(
        {
          success: false,
          error: 'Authentication required',
        },
        401
      );
    }

    const { credentialId } = c.req.valid('json');
    
    // Check if this is the user's last passkey
    const credentialCount = await countUserCredentials(c.env, userSession.user.id);
    
    if (credentialCount <= 1) {
      return c.json(
        {
          success: false,
          error: 'Cannot delete your last passkey. Add another passkey first.',
          code: 'LAST_PASSKEY',
        },
        400
      );
    }
    
    const deleted = await deleteCredential(c.env, userSession.user.id, credentialId);
    
    if (!deleted) {
      return c.json(
        {
          success: false,
          error: 'Passkey not found or unauthorized',
        },
        404
      );
    }

    logger.info('Credential deleted', {
      userId: userSession.user.id,
      credentialId,
      remainingCredentials: credentialCount - 1,
    });

    return c.json({
      success: true,
      message: 'Passkey removed successfully',
    });
  } catch (error) {
    logger.error('Failed to delete credential', {
      error: error instanceof Error ? error.message : String(error),
      credentialId: c.req.valid('json').credentialId,
    });
    
    return c.json(
      {
        success: false,
        error: 'Failed to remove passkey',
      },
      500
    );
  }
});

export default app;
