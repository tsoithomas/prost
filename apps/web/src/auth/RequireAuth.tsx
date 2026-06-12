import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../api/auth';
import { useAuthStore } from '../stores/authStore';

export interface RequireAuthProps {
  children: ReactNode;
}

/** Guards `/app/*`: redirects to `/login` if there's no token, or if `useMe` rejects it. */
export function RequireAuth({ children }: RequireAuthProps) {
  const token = useAuthStore((state) => state.token);
  const { isPending, isError } = useMe();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (isPending) {
    return <div className="flex h-screen items-center justify-center bg-bg text-sm text-text-muted">Loading…</div>;
  }

  if (isError) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
