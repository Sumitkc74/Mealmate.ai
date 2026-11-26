import type { QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useGuestStore, isGuestId } from '@/stores/guestStore';
import type { MealPlan, Recipe, User } from '@/types';
import type { RecipeInput } from '@/hooks/useRecipes';

/**
 * Migrate local guest data to the signed-in account, then remove the items
 * that were actually migrated from the guest store. Best-effort per item:
 * one failure never blocks the rest or breaks sign-in. Only migrated items
 * are removed — a failed item stays in the browser so a later sign-in can
 * retry it, and if the session is not actually working (the check below
 * fails) nothing is touched at all. The old behaviour cleared everything
 * even when every call failed, which wiped a guest's data on a broken
 * sign-in.
 *
 * Order matters: recipes first (plans reference them by id), then plans
 * (grocery lists are regenerated from the migrated plans), pantry last
 * (it is a merge, not a replace). Grocery lists have no direct create
 * endpoint, so they are regenerated from their migrated plan — manual
 * check-state on a guest list does not carry over.
 *
 * A plan is only posted when every guest recipe in its slots migrated
 * successfully: a failed recipe upload would otherwise leave that slot
 * `null` on the server plan while the guest plan is deleted, which no
 * later retry can repair. A kept plan keeps its recipes too, so the retry
 * can re-post the whole plan. A migrated plan's server id is recorded
 * durably in the guest store, so a grocery list whose regeneration failed
 * can still be linked to its server plan on a later run, after the guest
 * plan itself is gone. Likewise a migrated recipe's server id is recorded
 * durably: a recipe kept because its plan was kept stays in the store for
 * a later retry, and the retry reuses its server id instead of uploading
 * it again and creating a second server copy.
 */

export interface GuestMigrationResult {
  pantryMerged: number;
  recipesMigrated: number;
  recipesFailed: number;
  plansMigrated: number;
  plansFailed: number;
  listsRegenerated: number;
  listsFailed: number;
}

const EMPTY_RESULT: GuestMigrationResult = {
  pantryMerged: 0,
  recipesMigrated: 0,
  recipesFailed: 0,
  plansMigrated: 0,
  plansFailed: 0,
  listsRegenerated: 0,
  listsFailed: 0,
};

let migrationInFlight: Promise<GuestMigrationResult> | null = null;

function recipeToInput(recipe: Recipe): RecipeInput {
  return {
    title: recipe.title,
    description: recipe.description,
    cuisine: recipe.cuisine,
    tags: recipe.tags ?? [],
    difficulty: recipe.difficulty,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    servings: recipe.servings,
    imageUrl: recipe.imageUrl,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    nutrition: recipe.nutrition,
  };
}

function slotRecipeId(
  value: unknown,
  recipeIdMap: Map<string, string>
): string | null {
  if (!value || typeof value === 'string') return null;
  const recipe = value as Recipe;
  if (!recipe.id) return null;
  // Guest recipes map to their new server id; server recipes pass through.
  if (isGuestId(recipe.id)) return recipeIdMap.get(recipe.id) ?? null;
  return recipe.id;
}

/**
 * Guest recipe ids slotted into this plan that have no migrated server id
 * (their upload failed, or they are no longer in the guest store). Posting
 * the plan anyway would write `null` into those slots permanently.
 */
function unmigratedGuestRecipeIds(
  plan: MealPlan,
  recipeIdMap: Map<string, string>
): string[] {
  const missing: string[] = [];
  for (const d of plan.days) {
    for (const slot of [d.breakfast, d.lunch, d.dinner]) {
      if (slot && typeof slot === 'object') {
        const recipe = slot as Recipe;
        if (isGuestId(recipe.id) && !recipeIdMap.has(recipe.id)) {
          missing.push(recipe.id);
        }
      }
    }
  }
  return missing;
}

/** Guest recipe ids slotted into this plan (migrated or not). */
function slottedGuestRecipeIds(plan: MealPlan): string[] {
  const ids: string[] = [];
  for (const d of plan.days) {
    for (const slot of [d.breakfast, d.lunch, d.dinner]) {
      if (slot && typeof slot === 'object') {
        const recipe = slot as Recipe;
        if (isGuestId(recipe.id)) ids.push(recipe.id);
      }
    }
  }
  return ids;
}

async function migrateOnce(qc?: QueryClient): Promise<GuestMigrationResult> {
  const guest = useGuestStore.getState();
  const user = useAuthStore.getState().user;
  if (!user) return { ...EMPTY_RESULT };
  if (
    guest.pantry.length === 0 &&
    guest.recipes.length === 0 &&
    guest.mealPlans.length === 0 &&
    guest.groceryLists.length === 0 &&
    guest.allergies.length === 0
  ) {
    return { ...EMPTY_RESULT };
  }

  // Verify the session is real before touching any guest data. The local
  // user can be stale (e.g. set by a login whose cookie the browser never
  // stored), and every migration call would then 401 — clearing anything
  // would destroy guest data with nothing migrated. A failed check aborts
  // the run and leaves everything intact for a later sign-in.
  let sessionUser = user;
  try {
    const res = await api.get<{ user: User }>('/auth/me');
    if (res?.data?.user) sessionUser = res.data.user;
  } catch (err) {
    console.warn(
      '[guest migration] no working session, leaving guest data intact:',
      err instanceof Error ? err.message : err
    );
    return { ...EMPTY_RESULT };
  }

  const result: GuestMigrationResult = { ...EMPTY_RESULT };
  const failures: string[] = [];
  // Ids of the items that were actually migrated — only these are removed
  // from the guest store at the end.
  const migratedRecipeIds: string[] = [];
  const migratedPlanIds: string[] = [];
  const regeneratedListIds: string[] = [];
  let pantryMerged = false;
  let allergiesMigrated = false;

  // 0. Allergies: merge the guest's saved allergies into the account's
  // (union, deduped case-insensitively) without wiping the account's
  // existing ones — PATCH replaces the field, so the merge must happen
  // here. Uses the allergies from the session check above, so no extra
  // fetch is needed. Cleared from the guest store only if the PATCH
  // succeeds, so a failure is retried on a later sign-in.
  if (guest.allergies.length > 0) {
    try {
      const current = sessionUser.allergies ?? [];
      const seen = new Set(current.map((a) => a.toLowerCase().trim()));
      const merged = [...current];
      for (const allergy of guest.allergies) {
        const key = allergy.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(allergy);
        }
      }
      const { data } = await api.patch<{ user: User }>('/auth/me', {
        allergies: merged,
      });
      useAuthStore.getState().setUser(data.user);
      allergiesMigrated = true;
    } catch (err) {
      failures.push(`allergies: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  // 1. Recipes first — plans reference them by id. A recipe that already
  // migrated on an earlier run (its plan was kept, so the recipe was kept
  // too) is NOT re-uploaded: its server id is reused from the durable
  // map in the guest store, so the retry creates no second server copy.
  const recipeIdMap = new Map<string, string>();
  for (const recipe of guest.recipes) {
    const existingServerId = guest.migratedRecipeIds[recipe.id];
    if (existingServerId) {
      recipeIdMap.set(recipe.id, existingServerId);
      result.recipesMigrated += 1;
      migratedRecipeIds.push(recipe.id);
      continue;
    }
    try {
      const { data } = await api.post<{ recipe: Recipe }>(
        '/recipes',
        recipeToInput(recipe)
      );
      // Raw API payloads carry the server's _id; normalize to it if the
      // client-side id is absent.
      const raw = data.recipe as Recipe & { _id?: string };
      const serverId = raw.id ?? raw._id;
      if (serverId) {
        recipeIdMap.set(recipe.id, String(serverId));
        // Durable: if this recipe's plan is kept below, the recipe stays
        // too, and the retry needs this server id without re-uploading.
        useGuestStore.getState().recordMigratedRecipe(recipe.id, String(serverId));
      }
      result.recipesMigrated += 1;
      migratedRecipeIds.push(recipe.id);
    } catch (err) {
      result.recipesFailed += 1;
      failures.push(`recipe "${recipe.title}": ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  // 2. Meal plans, with slots remapped through the migrated recipe ids.
  // A plan whose guest recipe failed to upload is NOT posted: its slot
  // would be `null` on the server plan while the guest plan is deleted,
  // which no later retry could repair. The plan (and its recipes) stay
  // for a later run instead.
  const planIdMap = new Map<string, string>();
  for (const plan of guest.mealPlans) {
    const missing = unmigratedGuestRecipeIds(plan, recipeIdMap);
    if (missing.length > 0) {
      result.plansFailed += 1;
      failures.push(
        `meal plan ${plan.weekStartDate}: ${missing.length} recipe(s) did not migrate, keeping the plan for retry`
      );
      continue;
    }
    try {
      const days = plan.days.map((d) => ({
        day: d.day,
        breakfast: slotRecipeId(d.breakfast, recipeIdMap),
        lunch: slotRecipeId(d.lunch, recipeIdMap),
        dinner: slotRecipeId(d.dinner, recipeIdMap),
        snacks: [],
      }));
      const { data } = await api.post<{ plan: MealPlan }>('/mealplans', {
        weekStartDate: plan.weekStartDate,
        name: plan.name,
        notes: plan.notes,
        days,
      });
      const serverId = data.plan.id ?? (data.plan as unknown as { _id?: string })._id;
      if (serverId) {
        planIdMap.set(plan.id, String(serverId));
        // Durable: a grocery list whose regeneration fails below still
        // needs this server plan id on a later run, after this guest
        // plan is deleted.
        useGuestStore.getState().recordMigratedPlan(plan.id, String(serverId));
      }
      result.plansMigrated += 1;
      migratedPlanIds.push(plan.id);
    } catch (err) {
      result.plansFailed += 1;
      failures.push(`meal plan ${plan.weekStartDate}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  // 3. Pantry: merge guest items into the account pantry, deduped by name.
  // Uses the pantry from the session check above, not the possibly stale
  // local user, so items already on the account are not re-posted.
  if (guest.pantry.length > 0) {
    try {
      const current = sessionUser.pantry ?? [];
      const seen = new Set(current.map((p) => p.ingredient.toLowerCase().trim()));
      const additions = guest.pantry.filter((item) => {
        const name = item.ingredient.toLowerCase().trim();
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      if (additions.length > 0) {
        const { data } = await api.patch<{ user: User }>('/auth/me', {
          pantry: [...current, ...additions],
        });
        useAuthStore.getState().setUser(data.user);
        result.pantryMerged = additions.length;
      }
      // The merge succeeded (or there was nothing new to add): every guest
      // pantry item is now on the account, so the local copy can go.
      pantryMerged = true;
    } catch (err) {
      failures.push(`pantry: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  // 4. Grocery lists: regenerate from the migrated plan (no direct create
  // endpoint exists). Lists with no migrated plan are skipped. A list whose
  // plan was migrated on an earlier run resolves through the durable
  // migrated-plan map in the guest store, not just this run's in-memory
  // map — otherwise a list left behind by a failed regeneration could
  // never be linked to its server plan again.
  const regeneratedPlanGuestIds: string[] = [];
  for (const list of guest.groceryLists) {
    const newPlanId = list.mealPlan
      ? planIdMap.get(list.mealPlan) ?? guest.migratedPlanIds[list.mealPlan]
      : undefined;
    if (!newPlanId) {
      result.listsFailed += 1;
      failures.push(`grocery list ${list.id}: its meal plan was not migrated`);
      continue;
    }
    try {
      await api.post('/grocery/generate', { mealPlanId: newPlanId, usePantry: true });
      result.listsRegenerated += 1;
      regeneratedListIds.push(list.id);
      regeneratedPlanGuestIds.push(list.mealPlan);
    } catch (err) {
      result.listsFailed += 1;
      failures.push(`grocery list ${list.id}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  // Remove ONLY the items that were actually migrated. Failed items stay
  // in the browser so a later sign-in can retry them — never clearAll().
  // Recipes slotted into a plan that was kept (not migrated) stay too:
  // deleting a migrated recipe out from under a kept plan would leave the
  // plan referencing a guest recipe id that no longer exists, so the retry
  // could never post it. A deleted recipe's durable id mapping goes with
  // it (deleteRecipe drops the entry); a kept recipe keeps its mapping
  // so the retry can reuse its server id without re-uploading.
  const keptPlanRecipeIds = new Set<string>();
  for (const plan of guest.mealPlans) {
    if (migratedPlanIds.includes(plan.id)) continue;
    for (const id of slottedGuestRecipeIds(plan)) keptPlanRecipeIds.add(id);
  }
  const store = useGuestStore.getState();
  for (const id of migratedRecipeIds) {
    if (!keptPlanRecipeIds.has(id)) store.deleteRecipe(id);
  }
  for (const id of migratedPlanIds) store.deleteMealPlan(id);
  if (pantryMerged) store.clearPantry();
  if (allergiesMigrated) store.clearAllergies();
  for (const id of regeneratedListIds) store.deleteGroceryList(id);
  // A durable plan-id mapping is only needed while a local grocery list
  // still references that guest plan; drop it once no such list remains
  // (so a second list for the same plan is not stranded by the first
  // list's successful regeneration).
  for (const guestPlanId of new Set(regeneratedPlanGuestIds)) {
    if (
      !useGuestStore.getState().groceryLists.some((l) => l.mealPlan === guestPlanId)
    ) {
      useGuestStore.getState().forgetMigratedPlan(guestPlanId);
    }
  }
  if (failures.length > 0) {
    console.warn('[guest migration] some items could not be migrated:', failures);
  }
  if (qc) {
    void qc.invalidateQueries({ queryKey: ['recipes'] });
    void qc.invalidateQueries({ queryKey: ['mealplans'] });
    void qc.invalidateQueries({ queryKey: ['grocery'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  }
  return result;
}

/**
 * Migrate guest data to the signed-in account. Concurrent calls share one
 * in-flight run so a double trigger can't post the same items twice.
 */
export function migrateGuestData(qc?: QueryClient): Promise<GuestMigrationResult> {
  if (!migrationInFlight) {
    migrationInFlight = migrateOnce(qc).finally(() => {
      migrationInFlight = null;
    });
  }
  return migrationInFlight;
}
