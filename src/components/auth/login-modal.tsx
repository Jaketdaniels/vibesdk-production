/**
 * Enhanced Passkey-First Login Modal (Clean UX)
 * - Single sign-in CTA: Continue with Passkey
 * - If credential not found: inline CTA to Create a passkey (registration requires email)
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, KeyRound, Fingerprint, Mail } from 'lucide-react';
import { createPortal } from 'react-dom';
import FocusTrap from 'focus-trap-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPasskeyLogin: () => Promise<void>;
  onPasskeyRegister: (email?: string, displayName?: string) => Promise<void>;
  error?: string | null;
  onClearError?: () => void;
  actionContext?: string;
  showCloseButton?: boolean;
}

export function LoginModal({
  isOpen,
  onClose,
  onPasskeyLogin,
  onPasskeyRegister,
  error,
  onClearError,
  actionContext,
  showCloseButton = true,
}: LoginModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [registrationStep, setRegistrationStep] = useState<'email' | 'otp' | 'passkey'>('email');
  const [otp, setOtp] = useState('');
  const [otpMessage, setOtpMessage] = useState('');
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  // Store previously focused element and handle Escape key
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedElement.current = document.activeElement as HTMLElement;

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          handleClose();
        }
      };

      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // Return focus to previously focused element on close
  useEffect(() => {
    if (!isOpen && previouslyFocusedElement.current) {
      previouslyFocusedElement.current.focus();
      previouslyFocusedElement.current = null;
    }
  }, [isOpen]);

  const isValidEmail = (emailValue: string): boolean => {
    const normalized = emailValue.trim().toLowerCase();
    return !!normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  };

  const handleClose = () => {
    if (onClearError) onClearError();
    setShowRegister(false);
    setEmail('');
    setRegistrationStep('email');
    setOtp('');
    setOtpMessage('');
    onClose();
  };

  const handlePasskeyClick = async () => {
    setIsLoading(true);
    try {
      await onPasskeyLogin();
    } catch (_) {
      // Error handled via error prop; keep UI responsive
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!isValidEmail(normalized)) return;

    setIsLoading(true);
    setOtpMessage('');
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
        credentials: 'include',
      });

      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setRegistrationStep('otp');
        setOtpMessage('Verification code sent to your email');
      } else {
        setOtpMessage(data.error || 'Failed to send verification code');
      }
    } catch (_) {
      setOtpMessage('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (otp.length !== 6) return;

    setIsLoading(true);
    setOtpMessage('');
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized, otp }),
        credentials: 'include',
      });

      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setRegistrationStep('passkey');
        setOtpMessage('Email verified! Creating your passkey...');
        // Automatically trigger passkey creation
        setTimeout(() => {
          onPasskeyRegister(normalized);
        }, 500);
      } else {
        setOtpMessage(data.error || 'Invalid verification code');
      }
    } catch (_) {
      setOtpMessage('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    const normalized = email.trim().toLowerCase();
    setIsLoading(true);
    setOtpMessage('');
    try {
      const res = await fetch('/api/auth/otp/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
        credentials: 'include',
      });

      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setOtpMessage('New verification code sent');
      } else {
        setOtpMessage(data.error || 'Failed to resend code');
      }
    } catch (_) {
      setOtpMessage('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const shouldShowCredentialNotFoundCTA = !!error && (
    error.includes('not recognized') ||
    error.includes('No passkey') ||
    error.includes('CREDENTIAL_NOT_FOUND')
  );

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden="true"
          />

          <FocusTrap
            active={isOpen}
            focusTrapOptions={{
              initialFocus: false,
              allowOutsideClick: true,
              returnFocusOnDeactivate: false,
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
              className="relative z-10 w-full max-w-md"
            >
              <div className="bg-bg-3/95 backdrop-blur-xl text-text-primary border border-border-primary/50 rounded-2xl shadow-2xl overflow-hidden">
              <div className="relative p-8 pb-6">
                {showCloseButton && (
                  <button
                    onClick={handleClose}
                    className="absolute right-4 top-4 p-2 rounded-lg hover:bg-bg-4 transition-colors"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}

                <div className="text-center space-y-3">
                  <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4" aria-hidden="true">
                    {showRegister ? (
                      registrationStep === 'email' ? (
                        <Mail className="w-7 h-7 text-primary" />
                      ) : registrationStep === 'otp' ? (
                        <KeyRound className="w-7 h-7 text-primary" />
                      ) : (
                        <Fingerprint className="w-7 h-7 text-primary" />
                      )
                    ) : (
                      <Fingerprint className="w-7 h-7 text-primary" />
                    )}
                  </div>
                  <h2 id="modal-title" className="text-2xl font-semibold">
                    {actionContext
                      ? `Sign in ${actionContext}`
                      : showRegister
                      ? registrationStep === 'email'
                        ? 'Verify your email'
                        : registrationStep === 'otp'
                        ? 'Enter verification code'
                        : 'Creating passkey'
                      : 'Welcome back'}
                  </h2>
                  <p className="text-text-tertiary text-sm">
                    {showRegister
                      ? registrationStep === 'email'
                        ? 'We\'ll send a verification code to your email'
                        : registrationStep === 'otp'
                        ? `Code sent to ${email}`
                        : 'Please complete the passkey setup'
                      : 'Sign in securely with your device passkey'}
                  </p>
                </div>
              </div>

              {(error || otpMessage) && (
                <div className={`mx-8 mb-4 p-3 rounded-lg flex items-start gap-2 ${
                  otpMessage && !error
                    ? otpMessage.includes('sent') || otpMessage.includes('verified')
                      ? 'bg-primary/10 border border-primary/20'
                      : 'bg-destructive/10 border border-destructive/20'
                    : 'bg-destructive/10 border border-destructive/20'
                }`}>
                  <AlertCircle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                    otpMessage && !error
                      ? otpMessage.includes('sent') || otpMessage.includes('verified')
                        ? 'text-primary'
                        : 'text-destructive'
                      : 'text-destructive'
                  }`} />
                  <div className={`flex-1 text-sm ${
                    otpMessage && !error
                      ? otpMessage.includes('sent') || otpMessage.includes('verified')
                        ? 'text-primary'
                        : 'text-destructive'
                      : 'text-destructive'
                  }`}>{error || otpMessage}</div>
                </div>
              )}

              <div className="px-8 pb-8">
                {showRegister ? (
                  registrationStep === 'email' ? (
                    <form onSubmit={handleSendOTP} className="space-y-4">
                      <div>
                        <label htmlFor="email-input" className="sr-only">Email address</label>
                        <input
                          id="email-input"
                          type="email"
                          placeholder="Email address"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          autoComplete="email"
                          className="w-full p-3 rounded-lg border border-border-primary bg-bg-2/50 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                          disabled={isLoading}
                          required
                          aria-required="true"
                          aria-invalid={email && !isValidEmail(email) ? 'true' : 'false'}
                        />
                      </div>

                      <motion.button
                        type="submit"
                        whileTap={{ scale: 0.98 }}
                        disabled={isLoading || !isValidEmail(email)}
                        className="w-full group relative overflow-hidden rounded-xl bg-primary p-4 text-primary-foreground transition-all hover:bg-primary/90 border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                        aria-busy={isLoading}
                      >
                        <div className="relative z-10 flex items-center justify-center gap-3">
                          <Mail className={`h-5 w-5 ${isLoading ? 'animate-pulse' : ''}`} />
                          <span className="font-medium">
                            {isLoading ? 'Sending Code...' : 'Send Verification Code'}
                          </span>
                        </div>
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:translate-x-full transition-transform duration-700" />
                      </motion.button>

                      <button
                        type="button"
                        onClick={() => { setShowRegister(false); setRegistrationStep('email'); if (onClearError) onClearError(); }}
                        disabled={isLoading}
                        className="w-full text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
                      >
                        ← Back to sign in
                      </button>
                    </form>
                  ) : registrationStep === 'otp' ? (
                    <form onSubmit={handleVerifyOTP} className="space-y-4">
                      <div>
                        <label htmlFor="otp-input" className="sr-only">6-digit verification code</label>
                        <input
                          id="otp-input"
                          type="text"
                          placeholder="______"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          maxLength={6}
                          pattern="\d{6}"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          className="w-full p-3 rounded-lg border border-border-primary bg-bg-2/50 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-2xl text-center tracking-widest font-mono"
                          disabled={isLoading}
                          required
                          aria-required="true"
                          aria-invalid={otp && otp.length !== 6 ? 'true' : 'false'}
                        />
                      </div>

                      <motion.button
                        type="submit"
                        whileTap={{ scale: 0.98 }}
                        disabled={isLoading || otp.length !== 6}
                        className="w-full group relative overflow-hidden rounded-xl bg-primary p-4 text-primary-foreground transition-all hover:bg-primary/90 border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                        aria-busy={isLoading}
                      >
                        <div className="relative z-10 flex items-center justify-center gap-3">
                          <KeyRound className={`h-5 w-5 ${isLoading ? 'animate-pulse' : ''}`} />
                          <span className="font-medium">
                            {isLoading ? 'Verifying...' : 'Verify Code'}
                          </span>
                        </div>
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:translate-x-full transition-transform duration-700" />
                      </motion.button>

                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={handleResendOTP}
                          disabled={isLoading}
                          className="text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
                        >
                          Resend code
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRegistrationStep('email'); setOtp(''); setOtpMessage(''); }}
                          disabled={isLoading}
                          className="text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
                        >
                          Change email
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-4 text-center">
                      <p className="text-sm text-text-tertiary">
                        Please complete the passkey setup in your browser...
                      </p>
                    </div>
                  )
                ) : (
                  <div className="space-y-4">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={handlePasskeyClick}
                      disabled={isLoading}
                      className="w-full group relative overflow-hidden rounded-xl bg-primary p-4 text-primary-foreground transition-all hover:bg-primary/90 border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                    >
                      <div className="relative z-10 flex items-center justify-center gap-3">
                        <Fingerprint className="h-5 w-5" />
                        <span className="font-medium">
                          {isLoading ? 'Authenticating...' : 'Continue with Passkey'}
                        </span>
                      </div>
                      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:translate-x-full transition-transform duration-700" />
                    </motion.button>

                    <div className="text-center space-y-2">
                      {shouldShowCredentialNotFoundCTA && (
                        <button
                          type="button"
                          onClick={() => { setShowRegister(true); if (onClearError) onClearError(); }}
                          disabled={isLoading}
                          className="text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50 font-medium"
                        >
                          No passkey found? Create a passkey →
                        </button>
                      )}

                      {!shouldShowCredentialNotFoundCTA && (
                        <button
                          type="button"
                          onClick={() => { setShowRegister(true); if (onClearError) onClearError(); }}
                          disabled={isLoading}
                          className="text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
                        >
                          New here? Create a passkey
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-center text-xs text-text-tertiary mt-6">
                  By continuing, you agree to our{' '}
                  <a href="/terms" className="underline hover:text-text-primary">Terms of Service</a>{' '}and{' '}
                  <a href="/privacy" className="underline hover:text-text-primary">Privacy Policy</a>
                </p>
              </div>
            </div>
          </motion.div>
        </FocusTrap>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
