import mongoose, { Schema, Model, HydratedDocument, Types } from 'mongoose';

/**
 * Sentinel owner for community recipes. When an account is deleted, its
 * recipes are reassigned here instead of being deleted, so the shared
 * library keeps them. Any signed-in user may edit a community recipe, and
 * editing transfers ownership to the editor.
 */
export const COMMUNITY_OWNER_ID = new Types.ObjectId('000000000000000000000000');

export interface IRecipeIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface INutrition {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export interface IRecipe {
  title: string;
  slug: string;
  description?: string;
  ingredients: IRecipeIngredient[];
  instructions: string[];
  cuisine?: string;
  tags: string[];
  prepTime: number;
  cookTime: number;
  servings: number;
  nutrition: INutrition;
  imageUrl?: string;
  /**
   * Where the recipe photo came from: 'wikimedia' (CC-licensed, needs
   * attribution), 'pollinations' (AI-generated), or 'user' (pasted by the
   * author). Derived from the image URL host at write time, before the
   * image cache rewrites the URL to a local path.
   */
  imageSource?: 'wikimedia' | 'pollinations' | 'user';
  source?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  createdBy?: Types.ObjectId;
  /** True when the recipe was published while the AI check was unavailable, so it still needs an AI review once the service is back. */
  aiReviewPending?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRecipeVirtuals {
  totalTime: number;
}

export type RecipeDocument = HydratedDocument<IRecipe, Record<string, never>, IRecipeVirtuals>;
export type RecipeModel = Model<IRecipe, Record<string, never>, Record<string, never>, IRecipeVirtuals>;

const IngredientSchema = new Schema<IRecipeIngredient>(
  {
    name: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    quantity: { type: Number, min: 0 },
    unit: { type: String, trim: true, lowercase: true, maxlength: 20 },
  },
  { _id: false }
);

const NutritionSchema = new Schema<INutrition>(
  {
    calories: { type: Number, min: 0 },
    protein: { type: Number, min: 0 },
    carbs: { type: Number, min: 0 },
    fat: { type: Number, min: 0 },
    fiber: { type: Number, min: 0 },
    sugar: { type: Number, min: 0 },
    sodium: { type: Number, min: 0 },
  },
  { _id: false }
);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

const RecipeSchema = new Schema<IRecipe, RecipeModel, Record<string, never>, Record<string, never>, IRecipeVirtuals>(
  {
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
    slug: { type: String, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    ingredients: {
      type: [IngredientSchema],
      validate: {
        validator: (arr: IRecipeIngredient[]) => arr.length > 0,
        message: 'Recipe must have at least one ingredient',
      },
    },
    instructions: {
      type: [String],
      validate: {
        validator: (arr: string[]) => arr.length > 0,
        message: 'Recipe must have at least one instruction',
      },
    },
    cuisine: { type: String, trim: true, lowercase: true, maxlength: 50 },
    tags: { type: [String], default: [], index: true },
    prepTime: { type: Number, required: true, min: 0, max: 1440 },
    cookTime: { type: Number, required: true, min: 0, max: 1440 },
    servings: { type: Number, required: true, min: 1, max: 100 },
    nutrition: { type: NutritionSchema, default: () => ({}) },
    imageUrl: { type: String, trim: true },
    imageSource: { type: String, enum: ['wikimedia', 'pollinations', 'user'] },
    source: { type: String, trim: true },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    aiReviewPending: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Virtual: total time (prep + cook)
RecipeSchema.virtual('totalTime').get(function (this: RecipeDocument) {
  return (this.prepTime ?? 0) + (this.cookTime ?? 0);
});

// Full-text index on title + description + tags + ingredient names
RecipeSchema.index(
  { title: 'text', description: 'text', tags: 'text', 'ingredients.name': 'text' },
  { weights: { title: 10, tags: 5, 'ingredients.name': 3, description: 1 }, name: 'recipe_text_index' }
);
RecipeSchema.index({ cuisine: 1 });
RecipeSchema.index({ createdAt: -1 });

// Auto-slug from title
RecipeSchema.pre('validate', function (next) {
  if (!this.slug && this.title) {
    this.slug = `${slugify(this.title)}-${Date.now().toString(36)}`;
  }
  next();
});

export const Recipe =
  (mongoose.models.Recipe as RecipeModel) ||
  mongoose.model<IRecipe, RecipeModel>('Recipe', RecipeSchema);

export default Recipe;
