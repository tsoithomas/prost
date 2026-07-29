import { useState } from 'react';
import { LogOut, ScrollText } from 'lucide-react';
import { Button, Input, Toast } from '@prost/ui';
import { useChangePassword } from '../../api/auth';
import { apiErrorMessage } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { FormField } from '../../components/FormField';

export function AccountSection() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clear);
  const openAudit = useWorkspaceStore((s) => s.openAudit);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const closeSettings = useSettingsStore((s) => s.closeSettings);

  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setDone(true);
          setCurrentPassword('');
          setNewPassword('');
        },
        onError: (err) => setError(apiErrorMessage(err, 'Could not change password.')),
      },
    );
  }

  return (
    <div className="flex flex-col gap-md">
      {user ? (
        <p className="text-xs text-text-muted">
          Signed in as <span className="text-text">{user.email}</span>
        </p>
      ) : null}

      <form onSubmit={submitPassword} className="flex flex-col gap-sm border-t border-border pt-md">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-faint">Change password</p>
        {error ? <Toast variant="danger" message={error} onDismiss={() => setError(null)} /> : null}
        {done ? <Toast variant="success" message="Password updated." onDismiss={() => setDone(false)} /> : null}
        <FormField label="Current password">
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </FormField>
        <FormField label="New password">
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </FormField>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={!currentPassword || !newPassword || changePassword.isPending}
        >
          {changePassword.isPending ? 'Updating…' : 'Update password'}
        </Button>
      </form>
      <Button
        variant="secondary"
        size="sm"
        className="w-full justify-center"
        onClick={() => {
          openAudit(activeConnectionId ?? undefined);
          closeSettings();
        }}
      >
        <ScrollText size={14} />
        View audit log
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-center !text-danger"
        onClick={() => {
          clearAuth();
          closeSettings();
        }}
      >
        <LogOut size={14} />
        Sign out
      </Button>
    </div>
  );
}
