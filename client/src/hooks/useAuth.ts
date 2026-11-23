import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { AuthResponse, User } from '@/types';

interface LoginInput {
  email: string;
  password: string;
}

interface RegisterInput {
  name: string;
  email: string;
  password: string;
  termsAccepted?: boolean;
  dietaryConsent?: boolean;
  marketingOptIn?: boolean;
}

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LoginInput): Promise<AuthResponse> => {
      const { data } = await api.post<AuthResponse>('/auth/login', input);
      return data;
    },
    onSuccess: (data) => {
      setAuth(data);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useRegister() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterInput): Promise<AuthResponse> => {
      const { data } = await api.post<AuthResponse>('/auth/register', input);
      return data;
    },
    onSuccess: (data) => {
      setAuth(data);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (input: { email: string }): Promise<{ success: boolean; message: string }> => {
      const { data } = await api.post<{ success: boolean; message: string }>(
        '/auth/forgot-password',
        input
      );
      return data;
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: {
      token: string;
      password: string;
    }): Promise<{ success: boolean; message: string }> => {
      const { data } = await api.post<{ success: boolean; message: string }>(
        '/auth/reset-password',
        input
      );
      return data;
    },
  });
}

export function useMe() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  return useQuery({
    queryKey: ['me'],
    // Re-validate the session whenever a user is persisted (page reload):
    // the cookie is sent automatically, and a 401 clears auth via the api
    // interceptor.
    enabled: Boolean(user),
    queryFn: async (): Promise<User> => {
      const { data } = await api.get<{ user: User }>('/auth/me');
      setUser(data.user);
      return data.user;
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useQueryClient();
  return () => {
    // Clear the server-side httpOnly cookie too (fire-and-forget: local
    // state is cleared regardless).
    void api.post('/auth/logout').catch(() => undefined);
    logout();
    queryClient.clear();
  };
}
