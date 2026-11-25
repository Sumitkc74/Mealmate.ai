import { describe, it, expect } from 'vitest';
import { expandAllergies, findAllergyConflict } from '@/lib/allergens';

describe('expandAllergies', () => {
  it('expands a group allergy to its members', () => {
    const expanded = expandAllergies(['dairy']);
    expect(expanded.has('milk')).toBe(true);
    expect(expanded.has('butter')).toBe(true);
    expect(expanded.has('cheese')).toBe(true);
    expect(expanded.has('yogurt')).toBe(true);
    // The original term is kept too.
    expect(expanded.has('dairy')).toBe(true);
  });

  it('keeps a non-group term as itself only', () => {
    expect(expandAllergies(['sesame'])).toEqual(new Set(['sesame']));
  });

  it('returns an empty set for no allergies', () => {
    expect(expandAllergies([]).size).toBe(0);
  });
});

describe('findAllergyConflict', () => {
  it('reports the ingredient and the saved group allergy for a member ingredient', () => {
    const conflict = findAllergyConflict(
      ['flour', 'milk', 'egg', 'butter', 'sugar'],
      ['dairy']
    );
    expect(conflict).not.toBeNull();
    expect(conflict?.ingredient).toBe('milk');
    expect(conflict?.allergy).toBe('dairy');
  });

  it('catches a saved member allergy directly', () => {
    expect(
      findAllergyConflict(['flour', 'milk'], ['milk'])
    ).toEqual({ ingredient: 'milk', allergy: 'milk' });
  });

  it('returns null when nothing conflicts', () => {
    expect(findAllergyConflict(['rice', 'tomato', 'garlic'], ['dairy'])).toBeNull();
    expect(findAllergyConflict(['flour', 'milk'], [])).toBeNull();
    expect(findAllergyConflict([], ['dairy'])).toBeNull();
  });

  it('does not falsely match eggplant for an eggs allergy (whole-word matching)', () => {
    expect(findAllergyConflict(['eggplant', 'rice'], ['eggs'])).toBeNull();
    expect(findAllergyConflict(['egg'], ['eggs'])).not.toBeNull();
  });

  it('matches multi-word terms (heavy cream) and plurals (eggs)', () => {
    expect(findAllergyConflict(['heavy cream', 'sugar'], ['dairy'])).toEqual({
      ingredient: 'heavy cream',
      allergy: 'dairy',
    });
    expect(findAllergyConflict(['eggs', 'flour'], ['egg'])).toEqual({
      ingredient: 'eggs',
      allergy: 'egg',
    });
  });
});
