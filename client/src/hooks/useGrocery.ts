import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { GroceryList, GroceryCategory, PantryItem } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import {
  cacheGroceryList,
  getCachedGroceryList,
  queueOfflineGroceryUpdate,
} from '@/lib/offlineSync';

export function useGroceryLists() {
  return useQuery({
    queryKey: ['grocery'],
    queryFn: async (): Promise<GroceryList[]> => {
      const { data } = await api.get<{ items: GroceryList[] }>('/grocery');
      return data.items;
    },
  });
}

export function useGroceryList(id: string | undefined) {
  return useQuery({
    queryKey: ['grocery', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<GroceryList> => {
      try {
        const { data } = await api.get<{ list: GroceryList }>(`/grocery/${id}`);
        cacheGroceryList(data.list);
        return data.list;
      } catch (err) {
        if (id) {
          const cached = getCachedGroceryList(id);
          if (cached) return cached;
        }
        throw err;
      }
    },
  });
}

export interface UpdateGroceryItemInput {
  listId: string;
  itemId: string;
  patch: { checked?: boolean; quantity?: number; unit?: string; category?: GroceryCategory };
}

export function useUpdateGroceryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, itemId, patch }: UpdateGroceryItemInput): Promise<GroceryList> => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        queueOfflineGroceryUpdate(listId, itemId, patch);
        const cached = getCachedGroceryList(listId);
        if (cached) return cached;
      }
      try {
        const { data } = await api.patch<{ list: GroceryList }>(`/grocery/${listId}/items`, {
          itemId,
          ...patch,
        });
        cacheGroceryList(data.list);
        return data.list;
      } catch (err) {
        queueOfflineGroceryUpdate(listId, itemId, patch);
        const cached = getCachedGroceryList(listId);
        if (cached) return cached;
        throw err;
      }
    },
    // Optimistic update so checking a box feels instant.
    onMutate: async ({ listId, itemId, patch }) => {
      await qc.cancelQueries({ queryKey: ['grocery', listId] });
      const prev = qc.getQueryData<GroceryList>(['grocery', listId]);
      if (prev) {
        const updated: GroceryList = {
          ...prev,
          items: prev.items.map((it) =>
            it._id === itemId ? { ...it, ...patch } : it
          ),
        };
        qc.setQueryData<GroceryList>(['grocery', listId], updated);
        cacheGroceryList(updated);
      }
      return { prev };
    },
    onError: (_err, vars, context) => {
      // If truly offline, retain optimistic data rather than reverting
      if (typeof navigator !== 'undefined' && navigator.onLine && context?.prev) {
        qc.setQueryData(['grocery', vars.listId], context.prev);
      }
    },
    onSettled: (_data, _err, vars) => {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        qc.invalidateQueries({ queryKey: ['grocery', vars.listId] });
      }
    },
  });
}

export function useDeleteGroceryList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/grocery/${id}`);
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['grocery'] }),
  });
}

export interface TransferToPantryResult {
  message: string;
  count: number;
  pantry: PantryItem[];
}

export function useTransferToPantry() {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);

  return useMutation({
    mutationFn: async (listId: string): Promise<TransferToPantryResult> => {
      const { data } = await api.post<TransferToPantryResult>(
        `/grocery/${listId}/transfer-to-pantry`
      );
      return data;
    },
    onSuccess: (data, listId) => {
      if (user && data.pantry) {
        setUser({ ...user, pantry: data.pantry });
      }
      qc.invalidateQueries({ queryKey: ['grocery', listId] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
