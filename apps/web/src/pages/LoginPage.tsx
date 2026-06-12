import { useState } from 'react';
import type { FormEvent } from 'react';
import { Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Surface } from '@prost/ui';
import { useLogin } from '../api/auth';
import { FormField } from '../components/FormField';
import { ApiError } from '../lib/apiClient';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const login = useLogin();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    login.mutate(
      { email, password },
      {
        onSuccess: () => navigate('/app', { replace: true }),
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
        },
      },
    );
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-bg p-md text-text">
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'radial-gradient(var(--color-border) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <Surface level="raised" bordered className="relative z-10 flex w-full max-w-96 flex-col gap-lg rounded-lg p-lg shadow-2xl">
        <div className="flex items-center gap-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-accent-muted text-accent">
            <Database size={18} />
          </div>
          <span className="text-lg font-bold text-accent">Prost</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text">Sign in</h1>
          <p className="text-sm text-text-muted">Connect to your Prost workspace.</p>
        </div>
        <form className="flex flex-col gap-md" onSubmit={handleSubmit}>
          <FormField label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </FormField>
          <FormField label="Password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </FormField>
          {error ? (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="md" className="mt-xs justify-center" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
      </Surface>
    </div>
  );
}
