// Shared types mirroring the server API responses.

export type Role = 'user' | 'admin';

export interface CookingHistoryEntry {
  recipeId: string;
  recipeTitle: string;
  cookedAt: string;
  servingsCooked?: number;
  rating?: number;
  notes?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  pantry: PantryItem[];
  cookingHistory?: CookingHistoryEntry[];
  dietaryPreferences: string[];
  allergies: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PantryItem {
  ingredient: string;
  quantity?: string;
  unit?: string;
  category?: string;
  addedAt?: string;
  expiresAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Ingredient {
  name: string;
  quantity?: number;
  unit?: string;
  notes?: string;
}

export interface Nutrition {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Recipe {
  id: string;
  slug: string;
  title: string;
  description?: string;
  ingredients: Ingredient[];
  instructions: string[];
  prepTime: number;
  cookTime: number;
  totalTime?: number;
  servings: number;
  cuisine?: string;
  tags: string[];
  difficulty: Difficulty;
  nutrition?: Nutrition;
  imageUrl?: string;
  /** Provenance: 'seed' for bundled recipes, 'user' for ones you authored,
   *  'ai-generated' for recipes drafted by the AI chat / planner picker. */
  source?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type DayName =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';
export type Slot = 'breakfast' | 'lunch' | 'dinner';

export interface MealPlanDay {
  day: DayName;
  breakfast?: Recipe | string | null;
  lunch?: Recipe | string | null;
  dinner?: Recipe | string | null;
}

export interface MealPlan {
  id: string;
  user: string;
  name?: string;
  weekStartDate: string;
  days: MealPlanDay[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type GroceryCategory =
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'seafood'
  | 'bakery'
  | 'pantry'
  | 'frozen'
  | 'beverages'
  | 'snacks'
  | 'spices'
  | 'other';

export interface GroceryItemSource {
  recipe?: string;
  title: string;
  quantity?: number;
  unit?: string;
}

export interface GroceryItem {
  _id: string;
  ingredient: string;
  quantity?: number;
  unit?: string;
  category: GroceryCategory;
  checked: boolean;
  sources?: GroceryItemSource[];
}

export interface GroceryList {
  id: string;
  user: string;
  mealPlan: string;
  items: GroceryItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface WeeklyNutritionDay {
  day: DayName;
  nutrition: Required<Nutrition>;
}

export interface WeeklyNutrition {
  days: WeeklyNutritionDay[];
  total: Required<Nutrition>;
  average: Required<Nutrition>;
}

export interface ApiError {
  message: string;
  details?: unknown;
}
