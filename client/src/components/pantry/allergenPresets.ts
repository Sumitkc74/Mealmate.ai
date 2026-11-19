/**
 * Shared allergen preset list for the pantry Allergies section.
 * Kept in its own module (no components here) so the section file only
 * exports its component — see react-refresh/only-export-components.
 */

export interface AllergenPreset {
  id: string;
  label: string;
}

export const ALLERGEN_PRESETS: AllergenPreset[] = [
  { id: 'peanuts', label: 'Peanuts' },
  { id: 'tree-nuts', label: 'Tree Nuts' },
  { id: 'dairy', label: 'Milk / Dairy' },
  { id: 'eggs', label: 'Eggs' },
  { id: 'shellfish', label: 'Shellfish' },
  { id: 'fish', label: 'Fish' },
  { id: 'wheat', label: 'Wheat / Gluten' },
  { id: 'soy', label: 'Soy' },
  { id: 'sesame', label: 'Sesame' },
  { id: 'alliums', label: 'Alliums' },
  { id: 'mustard', label: 'Mustard' },
  { id: 'celery', label: 'Celery' },
  { id: 'sulfites', label: 'Sulfites' },
];
