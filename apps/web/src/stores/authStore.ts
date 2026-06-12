import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserDto } from '@prost/shared-types';

interface AuthState {
  token: string | null;
  user: UserDto | null;
  setAuth: (token: string, user: UserDto) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clear: () => set({ token: null, user: null }),
    }),
    {
      name: 'prost-auth',
    },
  ),
);
