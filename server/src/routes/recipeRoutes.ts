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
} from '../controllers/recipeController';
import { validate } from '../middleware/validate';
import { protect } from '../middleware/authMiddleware';
import {
  createRecipeSchema,
  bulkCreateRecipeSchema,
  updateRecipeSchema,
  listRecipesQuerySchema,
  recipeIdParamSchema,
  generateRecipeSchema,
  verifyRecipeSchema,
  estimateNutritionSchema,
} from '../validators/recipeSchemas';

const router = Router();

router.get('/', validate({ query: listRecipesQuerySchema }), listRecipes);
router.post('/verify', protect, validate({ body: verifyRecipeSchema }), verifyRecipeController);
router.post('/estimate-nutrition', protect, validate({ body: estimateNutritionSchema }), estimateNutritionController);
router.post('/generate', protect, validate({ body: generateRecipeSchema }), generateRecipe);
router.post('/bulk', protect, validate({ body: bulkCreateRecipeSchema }), bulkCreateRecipes);
router.get('/:id', validate({ params: recipeIdParamSchema }), getRecipe);
router.post('/', protect, validate({ body: createRecipeSchema }), createRecipe);
router.patch(
  '/:id',
  protect,
  validate({ params: recipeIdParamSchema, body: updateRecipeSchema }),
  updateRecipe
);
router.delete('/:id', protect, validate({ params: recipeIdParamSchema }), deleteRecipe);

export default router;
