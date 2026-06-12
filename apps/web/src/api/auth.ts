import { useMutation, useQuery } from '@tanstack/react-query';
import type { UserDto } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';

interface LoginResponse {
  token: string;
  user: UserDto;
}

export function useLogin() {
  const setAuth = useAuthStore((state) => state.setAuth);

  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: credentials }),
    onSuccess: (data) => {
      setAuth(data.token, data.user);
    },
  });
}

export function useMe() {
  const token = useAuthStore((state) => state.token);

  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<UserDto>('/auth/me'),
    enabled: token !== null,
    retry: false,
  });
}
