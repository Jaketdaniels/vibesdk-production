/**
 * OTP Email Verification Routes
 * Sends and verifies one-time passcodes for email verification during registration
 */

import { Hono } from 'hono';
import { Resend } from 'resend';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createLogger } from '../../logger';

const logger = createLogger('OTPAuth');

type AppEnv = { Bindings: Env };

const OTP_TTL_SECONDS = 600; // 10 minutes
const OTP_LENGTH = 6;

// Validation schemas
const sendOTPSchema = z.object({
  email: z.string().email(),
});

const verifyOTPSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(OTP_LENGTH).regex(/^\d+$/),
});

// Generate secure 6-digit OTP
function generateOTP(): string {
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0];
  const otp = (randomValue % 900000) + 100000;
  return otp.toString();
}

// KV key for OTP storage
function otpKey(email: string): string {
  return `otp:${email.toLowerCase().trim()}`;
}

const app = new Hono<AppEnv>();

// Send OTP to email
app.post('/send', zValidator('json', sendOTPSchema), async (c) => {
  try {
    const env = c.env as unknown as Env;
    const { email } = c.req.valid('json');
    const normalizedEmail = email.toLowerCase().trim();

    // Generate OTP
    const otp = generateOTP();

    // Store OTP in KV with 10-minute expiration
    const key = otpKey(normalizedEmail);
    await env.WEBAUTHN_CHALLENGES.put(
      key,
      JSON.stringify({ otp, createdAt: Date.now(), email: normalizedEmail }),
      { expirationTtl: OTP_TTL_SECONDS }
    );

    // Send email via Resend
    const resend = new Resend(env.RESEND_API_KEY);

    const emailBody = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff;border-radius:8px;">
        <h2 style="color:#0641AD;margin:0 0 20px 0;">Verify your email address</h2>
        <p>Hello,</p>
        <p>To complete your registration with netM8, please enter the following verification code:</p>
        <div style="font-size:2em;letter-spacing:10px;font-weight:bold;color:#0641AD;margin:24px 0;text-align:center;">${otp}</div>
        <p>This code will expire in 10 minutes. If you did not request this, you can safely ignore this email.</p>
        <p style="margin-top:32px;">Thanks,<br />The netM8 Team</p>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: 'netM8 <support@netm8.com>',
      to: [normalizedEmail],
      subject: 'Your netM8 verification code',
      html: emailBody,
    });

    if (error) {
      logger.error('Failed to send OTP email', { error, email: normalizedEmail });
      return c.json(
        {
          success: false,
          error: 'Failed to send verification email',
          code: 'EMAIL_SEND_FAILED',
        },
        500
      );
    }

    logger.info('OTP sent', { email: normalizedEmail });

    return c.json({
      success: true,
      data: {
        message: 'Verification code sent to your email',
        expiresIn: OTP_TTL_SECONDS,
      },
    });
  } catch (e) {
    logger.error('OTP send error', e);
    return c.json(
      {
        success: false,
        error: 'Failed to send verification code',
        code: 'INTERNAL_ERROR',
      },
      500
    );
  }
});

// Verify OTP
app.post('/verify', zValidator('json', verifyOTPSchema), async (c) => {
  try {
    const env = c.env as unknown as Env;
    const { email, otp } = c.req.valid('json');
    const normalizedEmail = email.toLowerCase().trim();

    // Retrieve stored OTP
    const key = otpKey(normalizedEmail);
    const stored = await env.WEBAUTHN_CHALLENGES.get(key);

    if (!stored) {
      return c.json(
        {
          success: false,
          error: 'Verification code expired or not found',
          code: 'OTP_EXPIRED',
        },
        400
      );
    }

    const { otp: storedOTP } = JSON.parse(stored);

    // Verify OTP matches
    if (otp !== storedOTP) {
      return c.json(
        {
          success: false,
          error: 'Invalid verification code',
          code: 'OTP_INVALID',
        },
        400
      );
    }

    // OTP is valid - mark as verified by updating the stored value
    await env.WEBAUTHN_CHALLENGES.put(
      key,
      JSON.stringify({ otp: storedOTP, verified: true, verifiedAt: Date.now(), email: normalizedEmail }),
      { expirationTtl: OTP_TTL_SECONDS } // Keep it around for passkey registration
    );

    logger.info('OTP verified', { email: normalizedEmail });

    return c.json({
      success: true,
      data: {
        verified: true,
        message: 'Email verified successfully',
      },
    });
  } catch (e) {
    logger.error('OTP verify error', e);
    return c.json(
      {
        success: false,
        error: 'Failed to verify code',
        code: 'INTERNAL_ERROR',
      },
      500
    );
  }
});

// Resend OTP (rate-limited to same flow as send)
app.post('/resend', zValidator('json', sendOTPSchema), async (c) => {
  // Just reuse the send logic
  return app.request('/send', {
    method: 'POST',
    body: JSON.stringify(c.req.valid('json')),
    headers: { 'Content-Type': 'application/json' },
  });
});

export default app;
