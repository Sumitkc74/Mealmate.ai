import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useGenerateRecipe, useCreateRecipe, type RecipeInput } from '@/hooks/useRecipes';
import { useAuthStore } from '@/stores/authStore';
import { extractErrorMessage } from '@/lib/api';
import type { Difficulty } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenImport?: () => void;
  initialMode?: 'suggest_existing' | 'generate_new';
  initialPrompt?: string;
}

type ModalStep = 'choose' | 'generating' | 'verify';

interface VerifiedDraftState {
  title: string;
  description: string;
  cuisine: string;
  tags: string;
  difficulty: Difficulty;
  prepTime: string;
  cookTime: string;
  servings: string;
  imageUrl?: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  ingredients: Array<{ name: string; quantity: string; unit: string }>;
  instructions: string[];
}

const INSPIRATION_CHIPS = [
  'Garlic Butter Tuscan Salmon',
  '15-Min Thai Basil Chicken',
  'Creamy Lemon Ricotta Pasta',
  'Crispy Sesame Peanut Noodles',
  'Moroccan Chickpea Sweet Potato Tagine',
  'Spicy Chipotle Black Bean Bowls',
];

export function AddRecipeModal({ open, onClose, onOpenImport, initialPrompt = '' }: Props) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState<ModalStep>('choose');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [respectPreferences, setRespectPreferences] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<VerifiedDraftState | null>(null);

  const generate = useGenerateRecipe();
  const create = useCreateRecipe();

  useEffect(() => {
    if (open) {
      setStep('choose');
      setError(null);
      if (initialPrompt) {
        setPrompt(initialPrompt);
      }
    }
  }, [open, initialPrompt]);

  if (!open) return null;

  const handleStartManual = () => {
    onClose();
    navigate('/recipes/new');
  };

  const handleOpenImport = () => {
    onClose();
    if (onOpenImport) {
      onOpenImport();
    }
  };

  const handleGenerate = async (queryText?: string) => {
    const q = (queryText ?? prompt).trim();
    if (!q || q.length < 2) {
      setError('Please enter a dish name or craving (at least 2 characters)');
      return;
    }

    setError(null);
    setStep('generating');

    try {
      const res = await generate.mutateAsync({
        query: q,
        dietaryPreferences: respectPreferences ? user?.dietaryPreferences : undefined,
        allergies: respectPreferences ? user?.allergies : undefined,
        save: false, // Request unpersisted draft so user can verify before saving
      });

      const r = res.recipe;
      setDraft({
        title: r.title,
        description: r.description ?? '',
        cuisine: r.cuisine ?? '',
        tags: (r.tags ?? []).join(', '),
        difficulty: (r.difficulty as Difficulty) || 'medium',
        prepTime: String(r.prepTime || 15),
        cookTime: String(r.cookTime || 20),
        servings: String(r.servings || 4),
        imageUrl: r.imageUrl,
        calories: r.nutrition?.calories ? String(r.nutrition.calories) : '',
        protein: r.nutrition?.protein ? String(r.nutrition.protein) : '',
        carbs: r.nutrition?.carbs ? String(r.nutrition.carbs) : '',
        fat: r.nutrition?.fat ? String(r.nutrition.fat) : '',
        ingredients: (r.ingredients || []).map((i) => ({
          name: i.name,
          quantity: i.quantity != null ? String(i.quantity) : '',
          unit: i.unit ?? '',
        })),
        instructions: r.instructions && r.instructions.length > 0 ? r.instructions : [''],
      });

      setStep('verify');
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not generate recipe. Please try another dish name.'));
      setStep('choose');
    }
  };

  const handleSaveVerified = async () => {
    if (!draft) return;
    setError(null);

    const validIngredients = draft.ingredients
      .filter((i) => i.name.trim().length > 0)
      .map((i) => ({
        name: i.name.trim(),
        quantity: i.quantity ? Number(i.quantity) : undefined,
        unit: i.unit.trim() || undefined,
      }));

    const validInstructions = draft.instructions.map((s) => s.trim()).filter(Boolean);

    if (!draft.title.trim() || draft.title.trim().length < 2) {
      setError('Recipe title must be at least 2 characters');
      return;
    }
    if (validIngredients.length === 0) {
      setError('At least one ingredient is required');
      return;
    }
    if (validInstructions.length === 0) {
      setError('At least one instruction step is required');
      return;
    }

    const payload: RecipeInput = {
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      cuisine: draft.cuisine.trim() || undefined,
      tags: draft.tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      difficulty: draft.difficulty,
      prepTime: Number(draft.prepTime) || 15,
      cookTime: Number(draft.cookTime) || 20,
      servings: Number(draft.servings) || 2,
      imageUrl: draft.imageUrl || undefined,
      ingredients: validIngredients,
      instructions: validInstructions,
      nutrition: {
        calories: draft.calories ? Number(draft.calories) : undefined,
        protein: draft.protein ? Number(draft.protein) : undefined,
        carbs: draft.carbs ? Number(draft.carbs) : undefined,
        fat: draft.fat ? Number(draft.fat) : undefined,
      },
    };

    try {
      const saved = await create.mutateAsync(payload);
      onClose();
      navigate(`/recipes/${saved.id}`);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save recipe to library'));
    }
  };

  const handleOpenInFullEditor = () => {
    if (!draft) return;
    onClose();
    navigate('/recipes/new', { state: { draftRecipe: draft } });
  };

  const handleReset = () => {
    setDraft(null);
    setPrompt('');
    setError(null);
    setStep('choose');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-recipe-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fadeIn"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-lg bg-card border border-line shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 id="add-recipe-modal-title" className="text-xl font-bold text-ink">
              {step === 'verify' ? 'Verify & Review Recipe' : 'Add a New Recipe'}
            </h2>
            <p className="text-xs text-ink-soft">
              {step === 'verify'
                ? 'Review generated details, adjust ingredients or steps, and confirm to save.'
                : 'Choose how you want to add this recipe to your collection.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-xs font-semibold text-ink-soft hover:bg-canvas-soft hover:text-ink transition"
            aria-label="Close modal"
          >
            Close
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 animate-fadeIn flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-red-700 hover:text-red-900 ml-2 font-semibold text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {step === 'choose' && (
            <div className="space-y-5 animate-fadeIn">
              {/* 1. AI Recipe Generator */}
              <div className="rounded border border-line bg-canvas-soft p-4">
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    Suggest recipes not present in the system
                  </h3>
                  <p className="text-xs sm:text-sm text-ink-soft mt-0.5">
                    Pick a dish idea not in the catalog below, or type any recipe name. MealMate will generate ingredients, steps, and nutrition for you to verify.
                  </p>
                </div>

                {/* AI Input Form */}
                <div className="mt-4 space-y-3">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Creamy Tuscan Garlic Salmon, Thai Basil Chicken, Veggie Pad Thai..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleGenerate();
                        }
                      }}
                      className="flex-1 rounded border border-line bg-card px-3.5 py-2 text-sm text-ink placeholder-ink-soft shadow-xs focus:border-brand-500 focus:outline-none"
                      autoFocus
                    />
                    <Button
                      type="button"
                      onClick={() => handleGenerate()}
                      className="whitespace-nowrap bg-brand-600 hover:bg-brand-700 text-white"
                    >
                      Generate with AI
                    </Button>
                  </div>

                  {/* Suggestion Chips of Recipes NOT Present in System */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
                      AI Suggested Dish Ideas (Not in system):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {INSPIRATION_CHIPS.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => {
                            setPrompt(chip);
                            void handleGenerate(chip);
                          }}
                          className="rounded border border-line bg-card px-2.5 py-1 text-xs text-ink hover:border-brand-400 hover:text-brand-700 transition"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  </div>

                  {user && (user.dietaryPreferences?.length > 0 || user.allergies?.length > 0) && (
                    <label className="flex items-center gap-2 pt-1 text-xs text-ink-soft cursor-pointer">
                      <input
                        type="checkbox"
                        checked={respectPreferences}
                        onChange={(e) => setRespectPreferences(e.target.checked)}
                        className="rounded border-line text-brand-600 focus:ring-brand-500 cursor-pointer"
                      />
                      <span>
                        Include my profile preferences ({[...user.dietaryPreferences, ...user.allergies].join(', ')})
                      </span>
                    </label>
                  )}
                </div>
              </div>

              {/* 2. Other Options: Manual Form & Import */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleStartManual}
                  className="flex flex-col items-start rounded border border-line bg-card p-3.5 text-left transition hover:border-brand-500 group"
                >
                  <h4 className="font-semibold text-xs sm:text-sm text-ink group-hover:text-brand-700 transition">
                    Fill in manually
                  </h4>
                  <p className="text-[11px] text-ink-soft mt-0.5">
                    Write your own recipe from scratch with custom ingredients and steps.
                  </p>
                  <span className="mt-2 text-xs font-medium text-brand-600 group-hover:underline">
                    Open manual form
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenImport}
                  className="flex flex-col items-start rounded border border-line bg-card p-3.5 text-left transition hover:border-brand-500 group"
                >
                  <h4 className="font-semibold text-xs sm:text-sm text-ink group-hover:text-brand-700 transition">
                    Import spreadsheet
                  </h4>
                  <p className="text-[11px] text-ink-soft mt-0.5">
                    Upload multiple recipes in bulk from an Excel (.xlsx) or CSV file.
                  </p>
                  <span className="mt-2 text-xs font-medium text-brand-600 group-hover:underline">
                    Upload file
                  </span>
                </button>
              </div>
            </div>
          )}

          {step === 'generating' && (
            <div className="py-12 text-center space-y-4">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 shadow-inner">
                <span className="h-7 w-7 animate-spin rounded-full border-3 border-brand-600 border-t-transparent" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-gray-900">
                  Crafting &ldquo;{prompt}&rdquo; with AI…
                </h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  Generating ingredients with precise measurements, step-by-step cooking directions, and estimated nutrition for your verification.
                </p>
              </div>
            </div>
          )}

          {step === 'verify' && draft && (
            <div className="space-y-5 animate-fadeIn">
              {/* Verification Callout */}
              <div className="rounded border border-line bg-canvas-soft p-3.5 text-xs text-ink">
                <div>
                  <p className="font-semibold text-ink">AI Recipe Draft Ready</p>
                  <p className="text-ink-soft text-[11px] mt-0.5">
                    Please verify the ingredients, quantities, and instructions below. You can edit any field before saving.
                  </p>
                </div>
              </div>

              {/* Basic Fields */}
              <div className="space-y-3">
                <Input
                  label="Recipe Title *"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Recipe Title"
                  required
                />

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 p-2.5 text-sm text-gray-900 shadow-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    placeholder="Short description of this dish..."
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <Input
                    label="Cuisine"
                    value={draft.cuisine}
                    onChange={(e) => setDraft({ ...draft, cuisine: e.target.value })}
                    placeholder="e.g. Italian, Thai"
                  />
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Difficulty</label>
                    <select
                      value={draft.difficulty}
                      onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as Difficulty })}
                      className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm text-gray-700 shadow-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                  <Input
                    label="Prep (min)"
                    type="number"
                    value={draft.prepTime}
                    onChange={(e) => setDraft({ ...draft, prepTime: e.target.value })}
                  />
                  <Input
                    label="Cook (min)"
                    type="number"
                    value={draft.cookTime}
                    onChange={(e) => setDraft({ ...draft, cookTime: e.target.value })}
                  />
                </div>
              </div>

              {/* Ingredients Verification */}
              <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Verify Ingredients ({draft.ingredients.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        ingredients: [...draft.ingredients, { name: '', quantity: '', unit: '' }],
                      })
                    }
                    className="text-xs font-semibold text-brand-600 hover:text-brand-800"
                  >
                    + Add Ingredient
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {draft.ingredients.map((ing, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Qty"
                        value={ing.quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft({
                            ...draft,
                            ingredients: draft.ingredients.map((item, i) =>
                              i === idx ? { ...item, quantity: val } : item
                            ),
                          });
                        }}
                        className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-xs"
                      />
                      <input
                        type="text"
                        placeholder="Unit (tbsp, g)"
                        value={ing.unit}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft({
                            ...draft,
                            ingredients: draft.ingredients.map((item, i) =>
                              i === idx ? { ...item, unit: val } : item
                            ),
                          });
                        }}
                        className="w-24 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-xs"
                      />
                      <input
                        type="text"
                        placeholder="Ingredient name"
                        value={ing.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft({
                            ...draft,
                            ingredients: draft.ingredients.map((item, i) =>
                              i === idx ? { ...item, name: val } : item
                            ),
                          });
                        }}
                        className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = draft.ingredients.filter((_, i) => i !== idx);
                          setDraft({ ...draft, ingredients: next.length ? next : [{ name: '', quantity: '', unit: '' }] });
                        }}
                        className="text-gray-400 hover:text-red-600 px-1 text-xs"
                        aria-label="Remove ingredient"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Instructions Verification */}
              <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Verify Step-by-Step Instructions ({draft.instructions.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        instructions: [...draft.instructions, ''],
                      })
                    }
                    className="text-xs font-semibold text-brand-600 hover:text-brand-800"
                  >
                    + Add Step
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {draft.instructions.map((stepText, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-800 mt-1">
                        {idx + 1}
                      </span>
                      <textarea
                        rows={2}
                        value={stepText}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft({
                            ...draft,
                            instructions: draft.instructions.map((s, i) => (i === idx ? val : s)),
                          });
                        }}
                        className="flex-1 rounded-md border border-gray-300 p-2 text-xs text-gray-900 shadow-xs focus:border-brand-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = draft.instructions.filter((_, i) => i !== idx);
                          setDraft({ ...draft, instructions: next.length ? next : [''] });
                        }}
                        className="text-gray-400 hover:text-red-600 px-1 mt-1 text-xs"
                        aria-label="Remove step"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Nutrition Overview */}
              <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                  Nutrition Estimates (per serving)
                </p>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <span className="text-[10px] text-gray-500 block">Calories</span>
                    <input
                      type="number"
                      value={draft.calories}
                      onChange={(e) => setDraft({ ...draft, calories: e.target.value })}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                      placeholder="kcal"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 block">Protein</span>
                    <input
                      type="number"
                      value={draft.protein}
                      onChange={(e) => setDraft({ ...draft, protein: e.target.value })}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                      placeholder="g"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 block">Carbs</span>
                    <input
                      type="number"
                      value={draft.carbs}
                      onChange={(e) => setDraft({ ...draft, carbs: e.target.value })}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                      placeholder="g"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 block">Fat</span>
                    <input
                      type="number"
                      value={draft.fat}
                      onChange={(e) => setDraft({ ...draft, fat: e.target.value })}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                      placeholder="g"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas px-6 py-3.5">
          {step === 'verify' ? (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-ink-soft hover:text-ink underline"
              >
                Try another idea
              </button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleOpenInFullEditor}
                  title="Open this verified draft in the full page recipe form"
                >
                  Full Page Editor
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveVerified}
                  loading={create.isPending}
                  className="bg-brand-600 hover:bg-brand-700 text-white font-semibold"
                >
                  Verify &amp; Save Recipe
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <div className="text-xs text-gray-400">
                You can always edit recipes later
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
