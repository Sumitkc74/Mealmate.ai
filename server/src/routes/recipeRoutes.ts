import { Router } from 'express';
import {
  listRecipes,
  getRecipe,
  createRecipe,
  bulkCreateRecipes,
  updateRecipe,
  deleteRecipe,
  generateRecipe,
  verifyRecipeController,
  estimateNutritionController,
  reverifyPendingRecipesController,
} from '../controllers/recipeController';
import { validate } from '../middleware/validate';
import { protect } from '../middleware/authMiddleware';
import { aiCostLimiter } from '../middleware/aiCostLimiter';
import {
  createRecipeSchema,
  bulkCreateRecipeSchema,
  updateRecipeSchema,
  listRecipesQuerySchema,
  recipeIdParamSchema,
  recipeIdOrSlugParamSchema,
  generateRecipeSchema,
  verifyRecipeSchema,
  estimateNutritionSchema,
} from '../validators/recipeSchemas';

const router = Router();

router.get('/', validate({ query: listRecipesQuerySchema }), listRecipes);
router.post('/verify', protect, aiCostLimiter, validate({ body: verifyRecipeSchema }), verifyRecipeController);
router.post(
  '/estimate-nutrition',
  protect,
  aiCostLimiter,
  validate({ body: estimateNutritionSchema }),
  estimateNutritionController
);
router.post('/generate', protect, aiCostLimiter, validate({ body: generateRecipeSchema }), generateRecipe);
router.post('/bulk', protect, aiCostLimiter, validate({ body: bulkCreateRecipeSchema }), bulkCreateRecipes);
router.post('/reverify-pending', protect, aiCostLimiter, reverifyPendingRecipesController);
router.get('/:id', validate({ params: recipeIdOrSlugParamSchema }), getRecipe);
router.post('/', protect, validate({ body: createRecipeSchema }), createRecipe);
router.patch(
  '/:id',
  protect,
  validate({ params: recipeIdParamSchema, body: updateRecipeSchema }),
  updateRecipe
);
router.delete('/:id', protect, validate({ params: recipeIdParamSchema }), deleteRecipe);

export default router;
