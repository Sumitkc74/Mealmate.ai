import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MealPlan, DayName, Slot, GroceryList } from '@/types';

export function useMealPlans(enabled = true) {
  return useQuery({
    queryKey: ['mealplans'],
    enabled,
    queryFn: async (): Promise<MealPlan[]> => {
      const { data } = await api.get<{ items: MealPlan[] }>('/mealplans');
      return data.items;
    },
  });
}

export function useMealPlan(id: string | undefined) {
  return useQuery({
    queryKey: ['mealplan', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<MealPlan> => {
      const { data } = await api.get<{ plan: MealPlan }>(`/mealplans/${id}`);
      return data.plan;
    },
  });
}

export function useCreateMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { weekStartDate: string; name?: string }): Promise<MealPlan> => {
      const { data } = await api.post<{ plan: MealPlan }>('/mealplans', input);
      return data.plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mealplans'] }),
  });
}

export interface AssignSlotInput {
  planId: string;
  day: DayName;
  slot: Slot;
  recipeId: string | null;
}

export function useAssignSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, day, slot, recipeId }: AssignSlotInput): Promise<MealPlan> => {
      const { data } = await api.post<{ plan: MealPlan }>(`/mealplans/${planId}/assign`, {
        day,
        slot,
        recipeId,
      });
      return data.plan;
    },
    onSuccess: (plan) => {
      qc.setQueryData(['mealplan', plan.id], plan);
      qc.invalidateQueries({ queryKey: ['mealplans'] });
      qc.invalidateQueries({ queryKey: ['mealplan', plan.id] });
    },
  });
}

export function useDeleteMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/mealplans/${id}`);
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mealplans'] }),
  });
}

export function useGenerateGrocery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { mealPlanId: string; usePantry?: boolean }): Promise<GroceryList> => {
      const { data } = await api.post<{ list: GroceryList }>('/grocery/generate', input);
      return data.list;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['grocery'] }),
  });
}
