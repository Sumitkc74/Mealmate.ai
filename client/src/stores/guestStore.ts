import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  DayName,
  GroceryCategory,
  GroceryList,
  MealPlan,
  MealPlanDay,
  PantryItem,
  Recipe,
  Slot,
} from '@/types';
import type { RecipeInput } from '@/hooks/useRecipes';
import { DAYS_OF_WEEK } from '@/lib/week';

/**
 * Local-only guest data. Guests can try the planner, pantry, grocery lists
 * and recipe adding without an account; everything lives in this browser
 * (localStorage) and never touches the server. When the guest signs in,
 * `migrateGuestData` (lib/guestMigration) pushes it to their account and
 * this store is cleared.
 *
 * Ids are prefixed `guest-` so guest records can never collide with server
 * ids and can be recognised anywhere in the UI.
 */
export function newGuestId(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `guest-${uuid}`;
}

export function isGuestId(id: string | undefined | null): boolean {
  return Boolean(id && id.startsWith('guest-'));
}

export function isGuestRecipe(recipe: Pick<Recipe, 'id'> | undefined | null): boolean {
  return Boolean(recipe && isGuestId(recipe.id));
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function emptyDays(): MealPlanDay[] {
  return DAYS_OF_WEEK.map((day) => ({ day, breakfast: null, lunch: null, dinner: null }));
}

export function emptyGuestPlan(weekStartDate: string): MealPlan {
  const now = new Date().toISOString();
  return {
    id: newGuestId(),
    user: 'guest',
    weekStartDate,
    days: emptyDays(),
    createdAt: now,
    updatedAt: now,
  };
}

function toGuestRecipe(input: RecipeInput): Recipe {
  const id = newGuestId();
  const now = new Date().toISOString();
  return {
    id,
    slug: `${slugify(input.title) || 'recipe'}-${id.slice(6, 14)}`,
    title: input.title,
    description: input.description,
    ingredients: input.ingredients,
    instructions: input.instructions,
    prepTime: input.prepTime,
    cookTime: input.cookTime,
    totalTime: input.prepTime + input.cookTime,
    servings: input.servings,
    cuisine: input.cuisine,
    tags: input.tags ?? [],
    difficulty: input.difficulty ?? 'medium',
    nutrition: input.nutrition,
    imageUrl: input.imageUrl,
    source: 'user',
    createdBy: 'guest',
    createdAt: now,
    updatedAt: now,
  };
}

const SHELF_LIFE_DAYS: Record<string, number> = {
  produce: 5,
  dairy: 7,
  meat: 3,
  seafood: 2,
  bakery: 5,
  frozen: 180,
  pantry: 90,
  beverages: 30,
  snacks: 60,
  spices: 365,
  other: 14,
};

interface GuestState {
  pantry: PantryItem[];
  dietaryPreferences: string[];
  allergies: string[];
  mealPlans: MealPlan[];
  groceryLists: GroceryList[];
  recipes: Recipe[];
  /**
   * Guest plan id -> server plan id for plans already migrated. Durable
   * (persisted): a grocery list whose regeneration failed stays local after
   * its plan was migrated and deleted, and the next run needs the server
   * plan id to regenerate it — the in-memory planIdMap of that run is gone
   * by then. Entries are dropped once no local list references the plan.
   */
  migratedPlanIds: Record<string, string>;
  /**
   * Guest recipe id -> server recipe id for recipes already migrated.
   * Durable (persisted): a recipe kept because its plan was kept (the
   * plan could not be posted while another of its recipes had failed)
   * stays in the guest store for a later retry, and without this map the
   * retry would re-upload it, creating a second server copy. Entries are
   * dropped once the recipe itself is removed from the guest store.
   */
  migratedRecipeIds: Record<string, string>;

  // Pantry
  addPantryItem: (item: PantryItem) => void;
  removePantryItem: (idx: number) => void;
  clearPantry: () => void;
  clearAllergies: () => void;
  setPantry: (items: PantryItem[]) => void;
  addTag: (field: 'dietaryPreferences' | 'allergies', value: string) => void;
  removeTag: (field: 'dietaryPreferences' | 'allergies', value: string) => void;
  toggleTag: (field: 'dietaryPreferences' | 'allergies', value: string) => void;

  // Meal plans
  createMealPlan: (weekStartDate: string) => MealPlan;
  assignSlot: (planId: string, day: DayName, slot: Slot, recipe: Recipe | null) => void;
  deleteMealPlan: (planId: string) => void;
  recordMigratedPlan: (guestPlanId: string, serverPlanId: string) => void;
  forgetMigratedPlan: (guestPlanId: string) => void;

  // Grocery lists
  addGroceryList: (list: GroceryList) => void;
  updateGroceryItem: (
    listId: string,
    itemId: string,
    patch: { checked?: boolean; quantity?: number; unit?: string; category?: GroceryCategory }
  ) => void;
  deleteGroceryList: (listId: string) => void;
  transferCheckedToPantry: (listId: string) => { count: number };

  // Recipes
  addRecipe: (input: RecipeInput) => Recipe;
  updateRecipe: (id: string, input: Partial<RecipeInput>) => Recipe | null;
  deleteRecipe: (id: string) => void;
  recordMigratedRecipe: (guestRecipeId: string, serverRecipeId: string) => void;
  forgetMigratedRecipe: (guestRecipeId: string) => void;

  clearAll: () => void;
}

export const useGuestStore = create<GuestState>()(
  persist(
    (set, get) => ({
      pantry: [],
      dietaryPreferences: [],
      allergies: [],
      mealPlans: [],
      groceryLists: [],
      recipes: [],
      migratedPlanIds: {},
      migratedRecipeIds: {},

      addPantryItem: (item) => set((s) => ({ pantry: [...s.pantry, item] })),
      removePantryItem: (idx) =>
        set((s) => ({ pantry: s.pantry.filter((_, i) => i !== idx) })),
      clearPantry: () => set({ pantry: [] }),
      clearAllergies: () => set({ allergies: [] }),
      setPantry: (items) => set({ pantry: items }),

      addTag: (field, value) => {
        const cleaned = value.trim().toLowerCase();
        if (!cleaned) return;
        set((s) => {
          const current = s[field] ?? [];
          if (current.some((v) => v.toLowerCase() === cleaned)) return s;
          return { [field]: [...current, cleaned] } as Partial<GuestState>;
        });
      },
      removeTag: (field, value) => {
        const cleaned = value.trim().toLowerCase();
        set((s) => ({
          [field]: (s[field] ?? []).filter((v) => v.toLowerCase() !== cleaned),
        }) as Partial<GuestState>);
      },
      toggleTag: (field, value) => {
        const cleaned = value.trim().toLowerCase();
        if (!cleaned) return;
        set((s) => {
          const current = s[field] ?? [];
          const next = current.some((v) => v.toLowerCase() === cleaned)
            ? current.filter((v) => v.toLowerCase() !== cleaned)
            : [...current, cleaned];
          return { [field]: next } as Partial<GuestState>;
        });
      },

      createMealPlan: (weekStartDate) => {
        const plan = emptyGuestPlan(weekStartDate);
        set((s) => ({ mealPlans: [...s.mealPlans, plan] }));
        return plan;
      },
      assignSlot: (planId, day, slot, recipe) =>
        set((s) => ({
          mealPlans: s.mealPlans.map((p) =>
            p.id === planId
              ? {
                  ...p,
                  days: p.days.map((d) =>
                    d.day === day ? { ...d, [slot]: recipe } : d
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        })),
      deleteMealPlan: (planId) =>
        set((s) => ({ mealPlans: s.mealPlans.filter((p) => p.id !== planId) })),
      recordMigratedPlan: (guestPlanId, serverPlanId) =>
        set((s) => ({
          migratedPlanIds: { ...s.migratedPlanIds, [guestPlanId]: serverPlanId },
        })),
      forgetMigratedPlan: (guestPlanId) =>
        set((s) => {
          if (!(guestPlanId in s.migratedPlanIds)) return s;
          const next = { ...s.migratedPlanIds };
          delete next[guestPlanId];
          return { migratedPlanIds: next };
        }),

      addGroceryList: (list) => set((s) => ({ groceryLists: [...s.groceryLists, list] })),
      updateGroceryItem: (listId, itemId, patch) =>
        set((s) => ({
          groceryLists: s.groceryLists.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  items: l.items.map((it) =>
                    it._id === itemId ? { ...it, ...patch } : it
                  ),
                }
              : l
          ),
        })),
      deleteGroceryList: (listId) =>
        set((s) => ({ groceryLists: s.groceryLists.filter((l) => l.id !== listId) })),
      transferCheckedToPantry: (listId) => {
        const state = get();
        const list = state.groceryLists.find((l) => l.id === listId);
        if (!list) return { count: 0 };
        const checked = list.items.filter((it) => it.checked);
        if (checked.length === 0) return { count: 0 };
        const now = new Date();
        const moved: PantryItem[] = checked.map((item) => {
          const days = SHELF_LIFE_DAYS[item.category] ?? 14;
          return {
            ingredient: item.ingredient,
            quantity: item.quantity ? String(item.quantity) : undefined,
            unit: item.unit,
            category: item.category,
            addedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
          };
        });
        set((s) => ({
          pantry: [...s.pantry, ...moved],
          groceryLists: s.groceryLists.map((l) =>
            l.id === listId
              ? { ...l, items: l.items.filter((it) => !it.checked) }
              : l
          ),
        }));
        return { count: checked.length };
      },

      addRecipe: (input) => {
        const recipe = toGuestRecipe(input);
        set((s) => ({ recipes: [...s.recipes, recipe] }));
        return recipe;
      },
      updateRecipe: (id, input) => {
        const existing = get().recipes.find((r) => r.id === id);
        if (!existing) return null;
        const updated: Recipe = {
          ...existing,
          ...input,
          tags: input.tags ?? existing.tags,
          ingredients: input.ingredients ?? existing.ingredients,
          instructions: input.instructions ?? existing.instructions,
          totalTime:
            (input.prepTime ?? existing.prepTime) + (input.cookTime ?? existing.cookTime),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({
          recipes: s.recipes.map((r) => (r.id === id ? updated : r)),
        }));
        return updated;
      },
      deleteRecipe: (id) =>
        set((s) => {
          // No local item needs the mapping once the recipe itself is
          // gone: the migration only consults it for recipes still in
          // this list, and a kept plan's slot holds the full recipe.
          const next = { ...s.migratedRecipeIds };
          delete next[id];
          return {
            recipes: s.recipes.filter((r) => r.id !== id),
            migratedRecipeIds: next,
          };
        }),
      recordMigratedRecipe: (guestRecipeId, serverRecipeId) =>
        set((s) => ({
          migratedRecipeIds: { ...s.migratedRecipeIds, [guestRecipeId]: serverRecipeId },
        })),
      forgetMigratedRecipe: (guestRecipeId) =>
        set((s) => {
          if (!(guestRecipeId in s.migratedRecipeIds)) return s;
          const next = { ...s.migratedRecipeIds };
          delete next[guestRecipeId];
          return { migratedRecipeIds: next };
        }),

      clearAll: () =>
        set({
          pantry: [],
          dietaryPreferences: [],
          allergies: [],
          mealPlans: [],
          groceryLists: [],
          recipes: [],
          migratedPlanIds: {},
          migratedRecipeIds: {},
        }),
    }),
    {
      name: 'mealmate.guest',
      partialize: (state) => ({
        pantry: state.pantry,
        dietaryPreferences: state.dietaryPreferences,
        allergies: state.allergies,
        mealPlans: state.mealPlans,
        groceryLists: state.groceryLists,
        recipes: state.recipes,
        migratedPlanIds: state.migratedPlanIds,
        migratedRecipeIds: state.migratedRecipeIds,
      }),
    }
  )
);

/** True when the guest has any local data worth migrating on sign-in. */
export function hasGuestData(state: Pick<GuestState, 'pantry' | 'mealPlans' | 'groceryLists' | 'recipes' | 'allergies'>): boolean {
  return (
    state.pantry.length > 0 ||
    state.mealPlans.length > 0 ||
    state.groceryLists.length > 0 ||
    state.recipes.length > 0 ||
    state.allergies.length > 0
  );
}
