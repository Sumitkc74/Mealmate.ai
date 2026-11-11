import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/routing/ProtectedRoute';

// Route-level code splitting for performance and bundle size optimization
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const RecipesPage = lazy(() => import('@/pages/RecipesPage').then((m) => ({ default: m.RecipesPage })));
const RecipeDetailPage = lazy(() => import('@/pages/RecipeDetailPage').then((m) => ({ default: m.RecipeDetailPage })));
const RecipeFormPage = lazy(() => import('@/pages/RecipeFormPage').then((m) => ({ default: m.RecipeFormPage })));
const PlannerPage = lazy(() => import('@/pages/PlannerPage').then((m) => ({ default: m.PlannerPage })));
const PantryPage = lazy(() => import('@/pages/PantryPage').then((m) => ({ default: m.PantryPage })));
const GroceryPage = lazy(() => import('@/pages/GroceryPage').then((m) => ({ default: m.GroceryPage })));
const GroceryDetailPage = lazy(() => import('@/pages/GroceryDetailPage').then((m) => ({ default: m.GroceryDetailPage })));
const NutritionPage = lazy(() => import('@/pages/NutritionPage').then((m) => ({ default: m.NutritionPage })));
const PrivacyPolicyPage = lazy(() => import('@/pages/PrivacyPolicyPage').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsPage = lazy(() => import('@/pages/TermsPage').then((m) => ({ default: m.TermsPage })));
const AttributionsPage = lazy(() => import('@/pages/AttributionsPage').then((m) => ({ default: m.AttributionsPage })));
const ProfilePrivacyPage = lazy(() => import('@/pages/ProfilePrivacyPage').then((m) => ({ default: m.ProfilePrivacyPage })));

function RouteFallback() {
  return (
    <div className="flex h-64 w-full items-center justify-center" aria-label="Loading page">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="privacy" element={<PrivacyPolicyPage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="attributions" element={<AttributionsPage />} />

          <Route element={<PublicOnlyRoute />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route path="privacy/manage" element={<ProfilePrivacyPage />} />
            <Route path="recipes" element={<RecipesPage />} />
            <Route path="recipes/new" element={<RecipeFormPage mode="create" />} />
            <Route path="recipes/:id" element={<RecipeDetailPage />} />
            <Route path="recipes/:id/edit" element={<RecipeFormPage mode="edit" />} />
            <Route path="planner" element={<PlannerPage />} />
            <Route path="pantry" element={<PantryPage />} />
            <Route path="grocery" element={<GroceryPage />} />
            <Route path="grocery/:id" element={<GroceryDetailPage />} />
            <Route path="nutrition" element={<NutritionPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

