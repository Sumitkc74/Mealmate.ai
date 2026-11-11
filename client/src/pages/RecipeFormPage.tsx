import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  useCreateRecipe,
  useRecipe,
  useUpdateRecipe,
  useVerifyRecipe,
  useEstimateNutrition,
  type RecipeInput,
  type VerifyRecipeResponse,
} from '@/hooks/useRecipes';
import { RecipeImportModal } from '@/components/recipes/RecipeImportModal';
import { RecipeVerificationModal } from '@/components/recipes/RecipeVerificationModal';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';
import type { Difficulty } from '@/types';

const ShieldCheckIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);


interface IngredientRow {
  name: string;
  quantity: string;
  unit: string;
}

const emptyIngredient: IngredientRow = { name: '', quantity: '', unit: '' };

interface FormState {
  title: string;
  description: string;
  cuisine: string;
  tags: string;
  difficulty: Difficulty;
  prepTime: string;
  cookTime: string;
  servings: string;
  imageUrl: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  ingredients: IngredientRow[];
  instructions: string[];
}

const initialState: FormState = {
  title: '',
  description: '',
  cuisine: '',
  tags: '',
  difficulty: 'medium',
  prepTime: '10',
  cookTime: '20',
  servings: '2',
  imageUrl: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  ingredients: [{ ...emptyIngredient }],
  instructions: [''],
};

function toNum(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

interface RecipeFormPageProps {
  mode: 'create' | 'edit';
}

export function RecipeFormPage({ mode }: RecipeFormPageProps) {
  usePageMetadata({
    title: mode === 'edit' ? 'Edit Recipe | MealMate' : 'New Recipe | MealMate',
    description:
      'Create or edit your recipe details, ingredient quantities, preparation times, and step-by-step kitchen instructions with automated nutrition analysis.',
  });

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = mode === 'edit';

  const { data: existing, isLoading: loadingExisting } = useRecipe(isEdit ? id : undefined);
  const create = useCreateRecipe();
  const update = useUpdateRecipe(id ?? '');
  const verify = useVerifyRecipe();
  const estimateNutrition = useEstimateNutrition();

  const [form, setForm] = useState<FormState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerifyRecipeResponse | null>(null);
  const [pendingPayload, setPendingPayload] = useState<RecipeInput | null>(null);

  useEffect(() => {
    if (isEdit && existing) {
      setForm({
        title: existing.title,
        description: existing.description ?? '',
        cuisine: existing.cuisine ?? '',
        tags: (existing.tags ?? []).join(', '),
        difficulty: existing.difficulty,
        prepTime: String(existing.prepTime),
        cookTime: String(existing.cookTime),
        servings: String(existing.servings),
        imageUrl: existing.imageUrl ?? '',
        calories: existing.nutrition?.calories?.toString() ?? '',
        protein: existing.nutrition?.protein?.toString() ?? '',
        carbs: existing.nutrition?.carbs?.toString() ?? '',
        fat: existing.nutrition?.fat?.toString() ?? '',
        ingredients: existing.ingredients.map((i) => ({
          name: i.name,
          quantity: i.quantity?.toString() ?? '',
          unit: i.unit ?? '',
        })),
        instructions: existing.instructions.length ? existing.instructions : [''],
      });
    }
  }, [isEdit, existing]);

  function update_<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setIngredient(idx: number, patch: Partial<IngredientRow>) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  }
  function addIngredient() {
    setForm((f) => ({ ...f, ingredients: [...f.ingredients, { ...emptyIngredient }] }));
  }
  function removeIngredient(idx: number) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.length === 1 ? f.ingredients : f.ingredients.filter((_, i) => i !== idx),
    }));
  }

  function setInstruction(idx: number, value: string) {
    setForm((f) => ({
      ...f,
      instructions: f.instructions.map((s, i) => (i === idx ? value : s)),
    }));
  }
  function addInstruction() {
    setForm((f) => ({ ...f, instructions: [...f.instructions, ''] }));
  }
  function removeInstruction(idx: number) {
    setForm((f) => ({
      ...f,
      instructions: f.instructions.length === 1 ? f.instructions : f.instructions.filter((_, i) => i !== idx),
    }));
  }

  function buildPayload(): RecipeInput | null {
    const ingredients = form.ingredients
      .filter((i) => i.name.trim().length > 0)
      .map((i) => ({
        name: i.name.trim(),
        quantity: toNum(i.quantity),
        unit: i.unit.trim() || undefined,
      }));
    const instructions = form.instructions.map((s) => s.trim()).filter(Boolean);

    if (!form.title.trim() || form.title.trim().length < 2) {
      setError('Please provide a recipe title (at least 2 characters long).');
      return null;
    }
    if (ingredients.length === 0) {
      setError('Please add at least one ingredient with a valid name.');
      return null;
    }
    if (instructions.length === 0) {
      setError('Please add at least one step in the cooking instructions.');
      return null;
    }

    const nutrition = {
      calories: toNum(form.calories),
      protein: toNum(form.protein),
      carbs: toNum(form.carbs),
      fat: toNum(form.fat),
    };
    const hasNutrition = Object.values(nutrition).some((v) => v !== undefined);

    return {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      cuisine: form.cuisine.trim() || undefined,
      tags: form.tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      difficulty: form.difficulty,
      prepTime: toNum(form.prepTime) ?? 0,
      cookTime: toNum(form.cookTime) ?? 0,
      servings: toNum(form.servings) ?? 1,
      imageUrl: form.imageUrl.trim() || undefined,
      ingredients,
      instructions,
      nutrition: hasNutrition ? nutrition : undefined,
    };
  }

  async function executeSave(payload: RecipeInput) {
    try {
      if (isEdit) {
        const recipe = await update.mutateAsync(payload);
        navigate(`/recipes/${recipe.id}`);
      } else {
        const recipe = await create.mutateAsync(payload);
        navigate(`/recipes/${recipe.id}`);
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save recipe'));
    }
  }

  async function runVerification(payload: RecipeInput): Promise<VerifyRecipeResponse | null> {
    try {
      setIsVerificationModalOpen(true);
      const res = await verify.mutateAsync({
        title: payload.title,
        description: payload.description,
        cuisine: payload.cuisine,
        ingredients: payload.ingredients.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
        })),
        instructions: payload.instructions,
        prepTime: payload.prepTime,
        cookTime: payload.cookTime,
        servings: payload.servings,
      });
      setVerificationResult(res);
      return res;
    } catch (err) {
      setError(extractErrorMessage(err, 'Verification service encountered an error.'));
      setIsVerificationModalOpen(false);
      return null;
    }
  }

  async function handleVerifyClick() {
    setError(null);
    const payload = buildPayload();
    if (!payload) return;
    setPendingPayload(payload);
    await runVerification(payload);
  }

  async function handleEstimateNutrition() {
    setError(null);
    const validIngredients = form.ingredients
      .filter((i) => i.name.trim().length > 0)
      .map((i) => ({
        name: i.name.trim(),
        quantity: toNum(i.quantity),
        unit: i.unit.trim() || undefined,
      }));

    if (validIngredients.length === 0) {
      setError('Please add at least one ingredient with a quantity to calculate macros.');
      return;
    }

    try {
      const result = await estimateNutrition.mutateAsync({
        title: form.title.trim(),
        ingredients: validIngredients,
        servings: toNum(form.servings) || 2,
      });

      if (result.success) {
        update_('calories', String(Math.round(result.calories)));
        update_('protein', String(Math.round(result.protein)));
        update_('carbs', String(Math.round(result.carbs)));
        update_('fat', String(Math.round(result.fat)));
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to calculate nutrition estimates.'));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = buildPayload();
    if (!payload) return;

    setPendingPayload(payload);
    // Verify recipe before saving to check safety, edibility, and quality
    await runVerification(payload);
  }

  if (isEdit && loadingExisting) {
    return <p className="text-gray-600">Loading recipe…</p>;
  }

  const submitting = create.isPending || update.isPending;

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div>
        <Link to={isEdit && id ? `/recipes/${id}` : '/recipes'} className="text-sm text-brand-700 hover:underline">
          ← Cancel
        </Link>
        <h1 className="mt-1 text-3xl font-bold text-gray-900">
          {isEdit ? 'Edit recipe' : 'New recipe'}
        </h1>
      </div>

      {!isEdit && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-line bg-card p-4 text-sm text-ink shadow-xs">
          <div className="flex items-center gap-3">
            <div>
              <p className="font-semibold text-ink">Have multiple recipes to add?</p>
              <p className="text-ink-soft text-xs sm:text-sm">
                Import in bulk directly from a CSV or Excel (.xlsx) spreadsheet.
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0 bg-white hover:bg-brand-50 self-start sm:self-auto"
            onClick={() => setIsImportModalOpen(true)}
          >
            Import spreadsheet
          </Button>
        </div>
      )}

      <section className="grid gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:grid-cols-2">
        <Input
          label="Title"
          required
          value={form.title}
          onChange={(e) => update_('title', e.target.value)}
        />
        <Input
          label="Cuisine"
          value={form.cuisine}
          onChange={(e) => update_('cuisine', e.target.value)}
          placeholder="italian, asian, mexican…"
        />
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => update_('description', e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <Input
          label="Tags (comma-separated)"
          value={form.tags}
          onChange={(e) => update_('tags', e.target.value)}
          placeholder="vegetarian, quick, gluten-free"
        />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Difficulty</label>
          <select
            value={form.difficulty}
            onChange={(e) => update_('difficulty', e.target.value as Difficulty)}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <Input
          type="number"
          min={0}
          label="Prep time (min)"
          value={form.prepTime}
          onChange={(e) => update_('prepTime', e.target.value)}
        />
        <Input
          type="number"
          min={0}
          label="Cook time (min)"
          value={form.cookTime}
          onChange={(e) => update_('cookTime', e.target.value)}
        />
        <Input
          type="number"
          min={1}
          label="Servings"
          value={form.servings}
          onChange={(e) => update_('servings', e.target.value)}
        />
        <Input
          label="Image URL"
          value={form.imageUrl}
          onChange={(e) => update_('imageUrl', e.target.value)}
          placeholder="https://…"
        />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Ingredients</h2>
          <Button type="button" variant="secondary" size="sm" onClick={addIngredient}>
            + Add
          </Button>
        </div>
        <div className="space-y-2">
          {form.ingredients.map((ing, idx) => (
            <div key={idx} className="grid grid-cols-[1fr,90px,90px,auto] gap-2">
              <Input
                aria-label={`Ingredient ${idx + 1} name`}
                placeholder="e.g. chicken"
                value={ing.name}
                onChange={(e) => setIngredient(idx, { name: e.target.value })}
              />
              <Input
                aria-label={`Ingredient ${idx + 1} quantity`}
                placeholder="qty"
                type="number"
                value={ing.quantity}
                onChange={(e) => setIngredient(idx, { quantity: e.target.value })}
              />
              <Input
                aria-label={`Ingredient ${idx + 1} unit`}
                placeholder="g / cup"
                value={ing.unit}
                onChange={(e) => setIngredient(idx, { unit: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeIngredient(idx)}
                aria-label={`Remove ingredient ${idx + 1}`}
                className="text-xs text-ink-soft hover:text-red-700"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Instructions</h2>
          <Button type="button" variant="secondary" size="sm" onClick={addInstruction}>
            + Add step
          </Button>
        </div>
        <div className="space-y-2">
          {form.instructions.map((step, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                {idx + 1}
              </span>
              <textarea
                rows={2}
                value={step}
                onChange={(e) => setInstruction(idx, e.target.value)}
                aria-label={`Step ${idx + 1}`}
                placeholder={`Step ${idx + 1}`}
                className="w-full rounded border border-line bg-card px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeInstruction(idx)}
                aria-label={`Remove step ${idx + 1}`}
                className="text-xs text-ink-soft hover:text-red-700"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:grid-cols-4">
        <div className="flex flex-wrap items-center justify-between sm:col-span-4 gap-2">
          <h2 className="text-lg font-semibold text-gray-900">
            Nutrition <span className="text-sm font-normal text-gray-500">(per serving, optional)</span>
          </h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleEstimateNutrition}
            loading={estimateNutrition.isPending}
            className="text-xs flex items-center gap-1.5 border-emerald-200 text-emerald-800 hover:bg-emerald-50"
          >
            Calculate Macros
          </Button>
        </div>
        <Input
          type="number"
          min={0}
          label="Calories"
          value={form.calories}
          onChange={(e) => update_('calories', e.target.value)}
        />
        <Input
          type="number"
          min={0}
          label="Protein (g)"
          value={form.protein}
          onChange={(e) => update_('protein', e.target.value)}
        />
        <Input
          type="number"
          min={0}
          label="Carbs (g)"
          value={form.carbs}
          onChange={(e) => update_('carbs', e.target.value)}
        />
        <Input
          type="number"
          min={0}
          label="Fat (g)"
          value={form.fat}
          onChange={(e) => update_('fat', e.target.value)}
        />
      </section>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <ShieldCheckIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>Food safety and recipe verification active before publishing</span>
        </div>

        <div className="flex items-center gap-2">
          <Link to={isEdit && id ? `/recipes/${id}` : '/recipes'}>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
          <Button
            type="button"
            variant="secondary"
            onClick={handleVerifyClick}
            loading={verify.isPending}
            className="border-emerald-200 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center gap-1.5"
          >
            <ShieldCheckIcon className="w-4 h-4 text-emerald-600" />
            Verify Recipe
          </Button>
          <Button type="submit" loading={submitting || verify.isPending}>
            {isEdit ? 'Save changes' : 'Create recipe'}
          </Button>
        </div>
      </div>
    </form>

    <RecipeVerificationModal
      isOpen={isVerificationModalOpen}
      onClose={() => setIsVerificationModalOpen(false)}
      onConfirmPublish={() => {
        setIsVerificationModalOpen(false);
        if (pendingPayload) {
          void executeSave(pendingPayload);
        }
      }}
      isLoading={verify.isPending}
      verification={verificationResult}
      recipeTitle={form.title}
    />

    <RecipeImportModal
      open={isImportModalOpen}
      onClose={() => setIsImportModalOpen(false)}
      onSuccess={() => navigate('/recipes')}
    />
  </>
  );
}
