/**
 * Passkey-Only Login Modal
 * Clean, modern authentication using WebAuthn passkeys
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, KeyRound } from 'lucide-react';
import { createPortal } from 'react-dom';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPasskeyLogin: () => Promise<void>;
  onPasskeyRegister: () => Promise<void>;
  error?: string | null;
  onClearError?: () => void;
  actionContext?: string; // e.g., "to star this app", "to save your workspace"
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

  const handleClose = () => {
    if (onClearError) onClearError();
    onClose();
  };

  const handlePasskeyClick = async () => {
    setIsLoading(true);
    try {
      await onPasskeyLogin();
    } catch (_) {
      // Error handled in auth context
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
            className="relative z-10 w-full max-w-md"
          >
            <div className="bg-bg-3/95 backdrop-blur-xl text-text-primary border border-border-primary/50 rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
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
                    <KeyRound className="w-7 h-7 text-primary" />
                  </div>
                  <h2 className="text-2xl font-semibold">
                    {actionContext ? `Sign in ${actionContext}` : 'Welcome back'}
                  </h2>
                  <p className="text-text-tertiary text-sm">
                    {actionContext
                      ? 'Use your passkey to continue'
                      : 'Sign in with your passkey to access your workspace'}
                  </p>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="mx-8 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {/* Passkey Button */}
              <div className="px-8 pb-8">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePasskeyClick}
                  disabled={isLoading}
                  className="w-full group relative overflow-hidden rounded-xl bg-primary p-4 text-primary-foreground transition-all hover:bg-primary/90 border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                >
                  <div className="relative z-10 flex items-center justify-center gap-3">
                    <KeyRound className="h-5 w-5" />
                    <span className="font-medium">
                      {isLoading ? 'Authenticating...' : 'Continue with Passkey'}
                    </span>
                  </div>
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:translate-x-full transition-transform duration-700" />
                </motion.button>

                {/* Registration Link */}
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={async () => {
                      setIsLoading(true);
                      try {
                        await onPasskeyRegister();
                      } catch (_) {
                        // Error handled in auth context
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                    disabled={isLoading}
                    className="text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
                  >
                    New here? Create a passkey
                  </button>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-text-tertiary mt-6">
                  By continuing, you agree to our{' '}
                  <a href="/terms" className="underline hover:text-text-primary">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="/privacy" className="underline hover:text-text-primary">
                    Privacy Policy
                  </a>
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
