// src/components/byok-api-keys-modal.tsx

import { useState, useEffect } from 'react';
import {
  Key,
  Check,
  AlertCircle,
  Loader2,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import type { SecretTemplate } from '@/api-types';

// Provider logos
import OpenAILogo from '@/assets/provider-logos/openai.svg?react';
import AnthropicLogo from '@/assets/provider-logos/anthropic.svg?react';
import GoogleLogo from '@/assets/provider-logos/google.svg?react';
import CerebrasLogo from '@/assets/provider-logos/cerebras.svg?react';
import CloudflareLogo from '@/assets/provider-logos/cloudflare.svg?react';

interface ByokApiKeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyAdded?: () => void;
}

interface ManagedSecret {
  id: string;
  name: string;
  provider: string;
  keyPreview: string;
  isActive: boolean;
  lastUsed: string | null;
  createdAt: string;
  logo: React.ComponentType<{ className?: string }>;
}

const PROVIDER_LOGOS: Record<string, React.ComponentType<{ className?: string }>> = {
  openai: OpenAILogo,
  anthropic: AnthropicLogo,
  'google-ai-studio': GoogleLogo,
  cerebras: CerebrasLogo,
};

interface BYOKProvider {
  id: string;
  name: string;
  provider: string;
  logo: React.ComponentType<{ className?: string }>;
  placeholder: string;
  validation: RegExp;
}

function templateToBYOKProvider(template: SecretTemplate): BYOKProvider {
  const logo =
    PROVIDER_LOGOS[template.provider] ||
    (() => <div className="w-4 h-4 bg-gray-300 rounded" />);
  return {
    id: template.id,
    name: template.displayName.replace(' (BYOK)', ''),
    provider: template.provider,
    logo,
    placeholder: template.placeholder,
    validation: new RegExp(template.validation),
  };
}

export function ByokApiKeysModal({
  isOpen,
  onClose,
  onKeyAdded,
}: ByokApiKeysModalProps) {
  const [activeTab, setActiveTab] = useState<'add' | 'manage'>('add');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [byokProviders, setBYOKProviders] = useState<BYOKProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [managedSecrets, setManagedSecrets] = useState<ManagedSecret[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [toggleLoadingId, setToggleLoadingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretToDelete, setSecretToDelete] = useState<ManagedSecret | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const provider = byokProviders.find((p) => p.id === selectedProvider);

  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(null);
      setApiKey('');
      setIsSaving(false);
      setToggleLoadingId(null);
      setDeleteDialogOpen(false);
      setSecretToDelete(null);
      setIsDeleting(false);
      loadBYOKProviders();
      loadManagedSecrets();
    }
  }, [isOpen]);

  async function loadBYOKProviders() {
    try {
      setIsLoading(true);
      const res = await apiClient.getBYOKTemplates();
      if (res.success && res.data?.templates) {
        const providers = res.data.templates.map(templateToBYOKProvider);
        setBYOKProviders(providers);
      } else {
        toast.error('Failed to load BYOK providers');
      }
    } catch (error) {
      toast.error('Failed to load BYOK providers');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadManagedSecrets() {
    try {
      setLoadingSecrets(true);
      const res = await apiClient.getAllSecrets();
      if (res.success && res.data?.secrets) {
        const byok = res.data.secrets.filter((s) =>
          s.secretType.endsWith('_BYOK')
        );
        const managed = byok.map((s) => {
          const template = getBYOKTemplates().find(t => t.envVarName === s.secretType);
          const logo = template ? PROVIDER_LOGOS[template.provider] : () => <div className="w-4 h-4 bg-gray-300 rounded" />;
          return {
            id: s.id,
            name: s.name,
            provider: s.provider,
            keyPreview: s.keyPreview,
            isActive: s.isActive ?? false,
            lastUsed: s.lastUsed,
            createdAt: s.createdAt.toString(),
            logo,
          };
        });
        setManagedSecrets(managed);
      } else {
        toast.error('Failed to load managed secrets');
      }
    } catch (error) {
      toast.error('Failed to load managed secrets');
    } finally {
      setLoadingSecrets(false);
    }
  }


  const handleProviderSelect = (id: string) => {
    setSelectedProvider(id);
    setApiKey('');
  };

  const isKeyFormatValid = !!(
    provider &&
    apiKey &&
    provider.validation.test(apiKey)
  );

  async function handleSaveKey() {
    if (!provider || !apiKey || !isKeyFormatValid) return;
    setIsSaving(true);
    try {
      await apiClient.storeSecret({
        templateId: provider.id,
        value: apiKey.trim(),
        environment: 'production',
      });
      toast.success(`${provider.name} API key added successfully!`);
      onKeyAdded?.();
      await loadManagedSecrets();
      setActiveTab('manage');
      setSelectedProvider(null);
      setApiKey('');
    } catch {
      toast.error('Failed to save API key. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleSecret(id: string) {
    setToggleLoadingId(id);
    try {
      const res = await apiClient.toggleSecret(id);
      if (res.success && res.data) {
        toast.success(res.data.message);
        setManagedSecrets((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, isActive: res.data.secret.isActive ?? false }
              : s
          )
        );
        onKeyAdded?.();
      } else {
        toast.error('Failed to toggle secret status');
      }
    } catch {
      toast.error('Failed to toggle secret status');
    } finally {
      setToggleLoadingId(null);
    }
  }

  const openDeleteDialog = (secret: ManagedSecret) => {
    setSecretToDelete(secret);
    setDeleteDialogOpen(true);
  };

  async function handleDeleteSecret() {
    if (!secretToDelete) return;
    setIsDeleting(true);
    try {
      await apiClient.deleteSecret(secretToDelete.id);
      toast.success(`${secretToDelete.name} API key deleted successfully`);
      setManagedSecrets((prev) =>
        prev.filter((s) => s.id !== secretToDelete.id)
      );
      onKeyAdded?.();
      setDeleteDialogOpen(false);
      setSecretToDelete(null);
    } catch {
      toast.error('Failed to delete API key');
    } finally {
      setIsDeleting(false);
    }
  }

  function formatDate(str: string) {
    return new Date(str).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" /> Bring Your Own Key{' '}
              <span className="flex items-center gap-1 text-xs text-text-tertiary font-normal">
                via <CloudflareLogo className="h-3 w-3" /> AI Gateway
              </span>
            </DialogTitle>
            <DialogDescription>
              Add your API keys to use your own provider accounts for billing,
              or manage existing keys
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'add' | 'manage')}
            className="space-y-6"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="add" className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> Add Keys
              </TabsTrigger>
              <TabsTrigger value="manage" className="flex items-center gap-2">
                <Settings className="h-4 w-4" /> Manage Keys
              </TabsTrigger>
            </TabsList>

            <TabsContent value="add" className="space-y-6">
              <div className="space-y-3">
                <Label className="text-sm font-medium">
                  Select Provider
                </Label>
                {isLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="w-full flex items-center gap-3 p-3 rounded-lg border-2 border-gray-200"
                      >
                        <div className="w-8 h-8 bg-gray-200 rounded-md animate-pulse" />
                        <div className="h-4 bg-gray-200 rounded animate-pulse flex-1" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {byokProviders.map((opt) => {
                      const Logo = opt.logo;
                      const sel = selectedProvider === opt.id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => handleProviderSelect(opt.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all duration-200 text-left ${
                            sel
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center justify-center w-8 h-8 bg-white rounded-md border shadow-sm">
                            <Logo className="h-5 w-5" />
                          </div>
                          <span className="font-medium">{opt.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedProvider && provider && (
                <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                  <Label htmlFor="apiKey" className="text-sm font-medium">
                    Enter your {provider.name} API key
                  </Label>
                  <div className="relative">
                    <Input
                      id="apiKey"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={provider.placeholder}
                      className={`pr-10 ${
                        apiKey
                          ? isKeyFormatValid
                            ? 'border-green-500 focus:border-green-500'
                            : 'border-red-500 focus:border-red-500'
                          : ''
                      }`}
                    />
                    {apiKey && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {isKeyFormatValid ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    )}
                  </div>
                  {apiKey && !isKeyFormatValid && (
                    <p className="text-xs text-red-600">
                      Invalid format. Expected: {provider.placeholder}
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="manage" className="space-y-4">
              {loadingSecrets ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="flex items-center gap-4 p-4 rounded-lg border"
                    >
                      <div className="w-8 h-8 bg-gray-200 rounded-md animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded animate-pulse w-1/3" />
                        <div className="h-3 bg-gray-200 rounded animate-pulse w-1/2" />
                      </div>
                      <div className="w-12 h-6 bg-gray-200 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : managedSecrets.length === 0 ? (
                <div className="text-center py-8 text-text-tertiary">
                  <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">
                    No API keys configured
                  </p>
                  <p className="text-sm">
                    Add your first API key using the "Add Keys" tab
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {managedSecrets.map((secret) => {
                    const LogoComponent = secret.logo;
                    return (
                      <div
                        key={secret.id}
                        className="flex items-center gap-4 p-4 rounded-lg border hover:border-gray-300 transition-colors"
                      >
                        <div className="flex items-center justify-center w-8 h-8 bg-white rounded-md border shadow-sm">
                          <LogoComponent className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{secret.name}</span>
                            <Badge
                              variant={secret.isActive ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {secret.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-text-tertiary">
                            <span className="font-mono">
                              {secret.keyPreview}
                            </span>
                            <Separator orientation="vertical" className="h-3" />
                            <span>Added {formatDate(secret.createdAt)}</span>
                            {secret.lastUsed && (
                              <>
                                <Separator orientation="vertical" className="h-3" />
                                <span>
                                  Last used {formatDate(secret.lastUsed)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2">
                            <Label
                              htmlFor={`toggle-${secret.id}`}
                              className="text-xs text-text-tertiary"
                            >
                              {secret.isActive ? 'Active' : 'Inactive'}
                            </Label>
                            <Switch
                              id={`toggle-${secret.id}`}
                              checked={secret.isActive}
                              onCheckedChange={() =>
                                handleToggleSecret(secret.id)
                              }
                              disabled={toggleLoadingId === secret.id}
                            />
                            {toggleLoadingId === secret.id && (
                              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(secret)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            {activeTab === 'add' && selectedProvider && (
              <div className="flex gap-2 justify-end w-full">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveKey}
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save Key
                </Button>
              </div>
            )}
            {activeTab === 'manage' && (
              <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the {secretToDelete?.name} API key?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSecret}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
