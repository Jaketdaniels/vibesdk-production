/**
 * Passkey Setup Page
 * Allows users to enroll a passkey after email signup or for account recovery
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, Shield, Smartphone, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/auth-context';

export default function PasskeySetup() {
  const navigate = useNavigate();
  const { user, registerPasskey, error, clearError, isLoading } = useAuth();
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollmentSuccess, setEnrollmentSuccess] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);

  const handleEnrollPasskey = async () => {
    if (!user) return;
    
    setIsEnrolling(true);
    setEnrollmentError(null);
    clearError();

    try {
      await registerPasskey(user.email, user.displayName);
      setEnrollmentSuccess(true);
    } catch (err) {
      console.error('Passkey enrollment failed:', err);
      setEnrollmentError(error || 'Failed to create passkey. Please try again.');
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleSkip = () => {
    navigate('/');
  };

  const handleContinue = () => {
    navigate('/');
  };

  if (enrollmentSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-bg-1 via-bg-2 to-bg-3 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-bg-3/95 backdrop-blur-xl border border-border-primary/50 rounded-2xl p-8 text-center"
        >
          <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          
          <h1 className="text-2xl font-bold text-text-primary mb-4">
            Passkey Created Successfully!
          </h1>
          
          <p className="text-text-secondary mb-8">
            Your passkey has been set up. You can now sign in quickly and securely using your device's biometrics or PIN.
          </p>
          
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleContinue}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 px-6 rounded-lg font-medium transition-colors"
          >
            Continue to App
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-bg-1 via-bg-2 to-bg-3 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg w-full bg-bg-3/95 backdrop-blur-xl border border-border-primary/50 rounded-2xl p-8"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <button
            onClick={() => navigate(-1)}
            className="absolute top-6 left-6 p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
            <KeyRound className="w-8 h-8 text-primary" />
          </div>
          
          <h1 className="text-2xl font-bold text-text-primary mb-4">
            Set Up a Passkey
          </h1>
          
          <p className="text-text-secondary">
            Create a passkey for faster, more secure sign-ins using your device's biometrics or PIN.
          </p>
        </div>

        {/* Benefits */}
        <div className="space-y-4 mb-8">
          <div className="flex items-start gap-3 p-4 rounded-lg bg-bg-2/50">
            <Shield className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-text-primary mb-1">More Secure</h3>
              <p className="text-sm text-text-secondary">
                Passkeys are phishing-resistant and use your device's secure hardware.
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3 p-4 rounded-lg bg-bg-2/50">
            <Smartphone className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-text-primary mb-1">Faster Access</h3>
              <p className="text-sm text-text-secondary">
                Sign in with just your fingerprint, face, or device PIN.
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3 p-4 rounded-lg bg-bg-2/50">
            <KeyRound className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-text-primary mb-1">No Passwords</h3>
              <p className="text-sm text-text-secondary">
                No more forgetting or managing passwords for this account.
              </p>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {(error || enrollmentError) && (
          <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-destructive font-medium mb-1">
                Passkey setup failed
              </p>
              <p className="text-sm text-destructive/80">
                {error || enrollmentError}
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleEnrollPasskey}
            disabled={isEnrolling || isLoading}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 px-6 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isEnrolling ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Creating Passkey...
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                Create Passkey
              </>
            )}
          </motion.button>
          
          <button
            onClick={handleSkip}
            className="w-full py-3 px-6 text-text-secondary hover:text-text-primary transition-colors font-medium"
          >
            Skip for now
          </button>
        </div>

        {/* Note */}
        <div className="mt-6 p-4 rounded-lg bg-bg-2/30 border border-border/30">
          <p className="text-xs text-text-tertiary text-center">
            Your passkey will be stored securely on this device. You can create additional passkeys 
            on other devices from your account settings.
          </p>
        </div>
      </motion.div>
    </div>
  );
}