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
  const setUser = useAuthStore((s) => s.setUser);
  return useQuery({
    queryKey: ['me'],
    // Always re-validate the session on app load: the httpOnly cookie is
    // sent automatically, and a 200 restores the user even when local state
    // was cleared (e.g. by a transient 401). A 401 just means guest — the
    // api interceptor only clears local state, it never deletes the cookie,
    // so a later reload can still restore the session. No retry: a guest's
    // 401 is the expected answer, not a failure worth repeating.
    retry: false,
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
  return async () => {
    // Await the server logout (which clears the httpOnly cookie) BEFORE
    // clearing local state and the query cache. Previously the POST was
    // fire-and-forget, so the useMe refetch triggered by queryClient.clear()
    // could run while the cookie was still valid, and a 200 would restore
    // the user right after sign-out (seen live: an SPA navigation after
    // sign-out resurrected the session; a second sign-out + full load was
    // needed to show the guest state).
    try {
      await api.post('/auth/logout');
    } catch {
      // Local state is cleared regardless: a failed logout call must not
      // leave the user stuck signed in.
    }
    logout();
    queryClient.clear();
  };
}
