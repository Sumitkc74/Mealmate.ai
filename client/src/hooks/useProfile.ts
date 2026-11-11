import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { PantryItem, User, CookingHistoryEntry } from '@/types';

interface UpdateProfileInput {
  name?: string;
  pantry?: PantryItem[];
  cookingHistory?: CookingHistoryEntry[];
  dietaryPreferences?: string[];
  allergies?: string[];
}

export function useUpdateProfile() {
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProfileInput): Promise<User> => {
      const { data } = await api.patch<{ user: User }>('/auth/me', input);
      return data.user;
    },
    onSuccess: (user) => {
      setUser(user);
      qc.setQueryData(['me'], user);
    },
  });
}
