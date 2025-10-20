/**
 * Passkey Management Component
 * Following 2025 best practices for passkey UX and management
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  KeyRound,
  Plus,
  Trash2,
  Edit3,
  Smartphone,
  Monitor,
  Shield,
  Clock,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';

interface PasskeyCredential {
  id: string;
  credentialId: string;
  name?: string;
  aaguid?: string;
  createdAt: string;
  lastUsedAt?: string;
  transports?: string[];
  authenticatorType?: 'platform' | 'cross-platform';
}

interface PasskeyManagementProps {
  className?: string;
}

// AAGUID to authenticator name mapping
const AUTHENTICATOR_NAMES: Record<string, { name: string; icon: string }> = {
  // Apple devices
  'adce0002-35bc-c60a-648b-0b25f1f05503': { name: 'Touch ID / Face ID', icon: '🍎' },
  // Windows Hello
  '08987058-cadc-4b81-b6e1-30de50dcbe96': { name: 'Windows Hello', icon: '🪟' },
  // Google Password Manager
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': { name: 'Google Password Manager', icon: '🔐' },
  // Chrome
  'd548826e-79b4-db40-a3d8-11116f7e8349': { name: 'Chrome', icon: '🌐' },
  // Security Keys
  '2fc0579f-8113-47ea-b116-bb5a8db9202a': { name: 'YubiKey 5 Series', icon: '🔑' },
  'f8a011f3-8c0a-4d15-8006-17111f9edc7d': { name: 'Security Key', icon: '🔐' },
};

export function PasskeyManagement({ className }: PasskeyManagementProps) {
  const { user, registerPasskey } = useAuth();
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Load user's passkeys
  const loadCredentials = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const response = await apiClient.request('/api/auth/passkey/credentials', {
        method: 'GET',
      });
      
      if (response.success && response.data) {
        setCredentials(response.data.credentials || []);
      }
    } catch (error) {
      console.error('Failed to load passkeys:', error);
      setError('Failed to load your passkeys');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCredentials();
  }, [user]);

  const handleCreatePasskey = async () => {
    setIsCreating(true);
    setError(null);
    
    try {
      await registerPasskey(user?.email || undefined, user?.name || user?.displayName || undefined);
      await loadCredentials();
    } catch (error) {
      console.error('Failed to create passkey:', error);
      // Error is handled by auth context
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeletePasskey = async (credentialId: string) => {
    if (!confirm('Are you sure you want to remove this passkey? You won\'t be able to use it to sign in anymore.')) {
      return;
    }

    try {
      const response = await apiClient.request('/api/auth/passkey/credentials', {
        method: 'DELETE',
        body: { credentialId },
      });
      
      if (response.success) {
        setCredentials(credentials.filter(c => c.credentialId !== credentialId));
      } else {
        setError('Failed to remove passkey');
      }
    } catch (error) {
      console.error('Failed to delete passkey:', error);
      setError('Failed to remove passkey');
    }
  };

  const handleRenamePasskey = async (credentialId: string, newName: string) => {
    if (!newName.trim()) return;
    
    try {
      const response = await apiClient.request('/api/auth/passkey/credentials', {
        method: 'PATCH',
        body: { credentialId, name: newName.trim() },
      });
      
      if (response.success) {
        setCredentials(credentials.map(c => 
          c.credentialId === credentialId 
            ? { ...c, name: newName.trim() }
            : c
        ));
        setEditingId(null);
        setEditName('');
      } else {
        setError('Failed to rename passkey');
      }
    } catch (error) {
      console.error('Failed to rename passkey:', error);
      setError('Failed to rename passkey');
    }
  };

  const getAuthenticatorInfo = (aaguid?: string) => {
    if (!aaguid) return { name: 'Unknown Device', icon: '🔐' };
    return AUTHENTICATOR_NAMES[aaguid] || { name: 'Security Device', icon: '🔐' };
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getTransportIcons = (transports?: string[]) => {
    if (!transports) return '🔐';
    
    const icons = {
      internal: <Monitor className="h-4 w-4" />,
      hybrid: <Smartphone className="h-4 w-4" />,
      usb: <KeyRound className="h-4 w-4" />,
      nfc: <Shield className="h-4 w-4" />,
      ble: <Smartphone className="h-4 w-4" />,
    };
    
    return (
      <div className="flex gap-1">
        {transports.map(transport => icons[transport as keyof typeof icons] || '🔐').slice(0, 2)}
      </div>
    );
  };

  if (!user) {
    return (
      <div className="p-6 text-center text-text-tertiary">
        Please sign in to manage your passkeys
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <KeyRound className="h-6 w-6" />
            Your Passkeys
          </h2>
          
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleCreatePasskey}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            {isCreating ? 'Creating...' : 'Add Passkey'}
          </motion.button>
        </div>
        
        <p className="text-text-tertiary text-sm">
          Manage your passkeys for secure, passwordless authentication. Each passkey is unique to this device or account.
        </p>
      </div>

      {/* Benefits Banner */}
      <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-medium text-text-primary text-sm">Phishing Resistant</h3>
              <p className="text-text-tertiary text-xs">Cannot be stolen or reused</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-medium text-text-primary text-sm">No Passwords</h3>
              <p className="text-text-tertiary text-xs">Biometric or PIN unlock</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-medium text-text-primary text-sm">Cross-Device</h3>
              <p className="text-text-tertiary text-xs">Sync across your devices</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-20 bg-bg-2 rounded-lg" />
            </div>
          ))}
        </div>
      ) : credentials.length === 0 ? (
        /* Empty State */
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium text-text-primary mb-2">No passkeys yet</h3>
          <p className="text-text-tertiary text-sm mb-4">
            Create your first passkey for fast, secure authentication
          </p>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleCreatePasskey}
            disabled={isCreating}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {isCreating ? 'Creating...' : 'Create Passkey'}
          </motion.button>
        </div>
      ) : (
        /* Passkeys List */
        <div className="space-y-3">
          {credentials.map((credential) => {
            const authInfo = getAuthenticatorInfo(credential.aaguid);
            const isEditing = editingId === credential.id;
            
            return (
              <motion.div
                key={credential.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-bg-2/50 border border-border-primary rounded-lg hover:bg-bg-2 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-lg">{authInfo.icon}</span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleRenamePasskey(credential.credentialId, editName);
                              } else if (e.key === 'Escape') {
                                setEditingId(null);
                                setEditName('');
                              }
                            }}
                            className="flex-1 px-2 py-1 text-sm border border-border-primary rounded bg-bg-3 focus:outline-none focus:border-primary"
                            placeholder="Enter a name for this passkey"
                            autoFocus
                          />
                          <button
                            onClick={() => handleRenamePasskey(credential.credentialId, editName)}
                            className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditName('');
                            }}
                            className="px-2 py-1 text-xs text-text-tertiary hover:text-text-primary"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <h3 className="font-medium text-text-primary text-sm mb-1">
                          {credential.name || `${authInfo.name} Passkey`}
                        </h3>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-text-tertiary">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Created {formatDate(credential.createdAt)}
                        </div>
                        {credential.lastUsedAt && (
                          <div className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" />
                            Last used {formatDate(credential.lastUsedAt)}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex items-center gap-1">
                          {getTransportIcons(credential.transports)}
                        </div>
                        <span className="text-xs text-text-tertiary">{authInfo.name}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1 ml-3">
                    <button
                      onClick={() => {
                        setEditingId(credential.id);
                        setEditName(credential.name || `${authInfo.name} Passkey`);
                      }}
                      className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-3 rounded transition-colors"
                      title="Rename passkey"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    
                    {credentials.length > 1 && (
                      <button
                        onClick={() => handleDeletePasskey(credential.credentialId)}
                        className="p-2 text-text-tertiary hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                        title="Remove passkey"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Security Notice */}
      <div className="mt-6 p-4 rounded-lg bg-bg-2/30 border border-border-primary/30">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-medium text-text-primary text-sm mb-1">Security Tip</h3>
            <p className="text-text-tertiary text-sm">
              We recommend having at least 2 passkeys - one on your primary device and one backup. 
              This ensures you can always access your account even if you lose a device.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}