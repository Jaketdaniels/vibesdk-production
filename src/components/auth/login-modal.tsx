/**
 * Enhanced Passkey-First Login Modal (Clean UX)
 * - Single sign-in CTA: Continue with Passkey
 * - If credential not found: inline CTA to Create a passkey (registration requires email)
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, KeyRound, Fingerprint } from 'lucide-react';
import { createPortal } from 'react-dom';

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

  const handleClose = () => {
    if (onClearError) onClearError();
    setShowRegister(false);
    setEmail('');
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

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return;

    setIsLoading(true);
    try {
      await onPasskeyRegister(normalized);
    } catch (_) {
      // Error handled in auth context
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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

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
                  <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    {showRegister ? (
                      <KeyRound className="w-7 h-7 text-primary" />
                    ) : (
                      <Fingerprint className="w-7 h-7 text-primary" />
                    )}
                  </div>
                  <h2 className="text-2xl font-semibold">
                    {actionContext
                      ? `Sign in ${actionContext}`
                      : showRegister
                      ? 'Create your passkey'
                      : 'Welcome back'}
                  </h2>
                  <p className="text-text-tertiary text-sm">
                    {showRegister
                      ? 'Enter your email to create a passkey for this account'
                      : 'Sign in securely with your device passkey'}
                  </p>
                </div>
              </div>

              {error && (
                <div className="mx-8 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                  <div className="flex-1 text-sm text-destructive">{error}</div>
                </div>
              )}

              <div className="px-8 pb-8">
                {showRegister ? (
                  <form onSubmit={handleRegisterSubmit} className="space-y-4">
                    <div>
                      <input
                        type="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full p-3 rounded-lg border border-border-primary bg-bg-2/50 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                        disabled={isLoading}
                        required
                      />
                    </div>

                    <motion.button
                      type="submit"
                      whileTap={{ scale: 0.98 }}
                      disabled={isLoading}
                      className="w-full group relative overflow-hidden rounded-xl bg-primary p-4 text-primary-foreground transition-all hover:bg-primary/90 border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                    >
                      <div className="relative z-10 flex items-center justify-center gap-3">
                        <KeyRound className="h-5 w-5" />
                        <span className="font-medium">
                          {isLoading ? 'Creating Passkey...' : 'Create Passkey'}
                        </span>
                      </div>
                      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:translate-x-full transition-transform duration-700" />
                    </motion.button>

                    <button
                      type="button"
                      onClick={() => { setShowRegister(false); if (onClearError) onClearError(); }}
                      disabled={isLoading}
                      className="w-full text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
                    >
                      ← Back to sign in
                    </button>
                  </form>
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
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
