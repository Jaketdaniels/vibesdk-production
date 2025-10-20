/**
 * Passkey-Only Authentication Modal Provider
 * Provides global authentication modal management using WebAuthn passkeys
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { LoginModal } from './login-modal';
import { useAuth } from '../../contexts/auth-context';
import { setGlobalAuthModalTrigger } from '../../lib/api-client';

interface AuthModalContextType {
  showAuthModal: (context?: string, onSuccess?: () => void) => void;
  hideAuthModal: () => void;
  isAuthModalOpen: boolean;
}

const AuthModalContext = createContext<AuthModalContextType | undefined>(undefined);

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (context === undefined) {
    throw new Error('useAuthModal must be used within an AuthModalProvider');
  }
  return context;
}

interface AuthModalProviderProps {
  children: React.ReactNode;
}

export function AuthModalProvider({ children }: AuthModalProviderProps) {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<(() => void) | undefined>();
  const { loginWithPasskey, error, clearError, isAuthenticated } = useAuth();

  const showAuthModal = useCallback((context?: string, onSuccess?: () => void) => {
    setModalContext(context);
    setPendingAction(onSuccess ? () => onSuccess : undefined);
    setIsAuthModalOpen(true);
  }, []);

  const hideAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setModalContext(undefined);
    setPendingAction(undefined);
    clearError();
  }, [clearError]);

  // Close modal and execute pending action when user becomes authenticated
  useEffect(() => {
    if (isAuthenticated && isAuthModalOpen) {
      hideAuthModal();
      if (pendingAction) {
        setTimeout(() => {
          pendingAction();
        }, 100);
      }
    }
  }, [isAuthenticated, pendingAction, isAuthModalOpen, hideAuthModal]);

  const handlePasskeyLogin = useCallback(async () => {
    try {
      await loginWithPasskey();
    } catch (error) {
      console.error('Passkey login failed:', error);
    }
  }, [loginWithPasskey]);

  // Set up global auth modal trigger for API client
  useEffect(() => {
    setGlobalAuthModalTrigger(showAuthModal);
  }, [showAuthModal]);

  const value: AuthModalContextType = {
    showAuthModal,
    hideAuthModal,
    isAuthModalOpen,
  };

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <LoginModal
        isOpen={isAuthModalOpen}
        onClose={hideAuthModal}
        onPasskeyLogin={handlePasskeyLogin}
        error={error}
        onClearError={clearError}
        actionContext={modalContext}
      />
    </AuthModalContext.Provider>
  );
}