/**
 * Shared diet preset list for the pantry Dietary Preferences section.
 * Kept in its own module (no components here) so the section file only
 * exports its component — see react-refresh/only-export-components.
 */

export interface DietPreset {
  id: string;
  label: string;
}

export const DIET_PRESETS: DietPreset[] = [
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'pescatarian', label: 'Pescatarian' },
  { id: 'keto', label: 'Keto' },
  { id: 'paleo', label: 'Paleo' },
  { id: 'gluten-free', label: 'Gluten-Free' },
  { id: 'dairy-free', label: 'Dairy-Free' },
  { id: 'mediterranean', label: 'Mediterranean' },
  { id: 'low-carb', label: 'Low-Carb' },
  { id: 'low-fodmap', label: 'Low-FODMAP' },
  { id: 'halal', label: 'Halal' },
  { id: 'kosher', label: 'Kosher' },
];
