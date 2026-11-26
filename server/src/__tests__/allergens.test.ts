import { expandAllergies, findAllergyConflict } from '../utils/allergens';

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

  it('does not block a plant milk for a dairy allergy', () => {
    // Thai Green Curry's only "milk" is coconut milk: not dairy.
    expect(
      findAllergyConflict(
        ['chicken breast', 'green curry paste', 'coconut milk', 'rice'],
        ['dairy']
      )
    ).toBeNull();
    expect(findAllergyConflict(['coconut milk', 'rice'], ['milk'])).toBeNull();
    expect(findAllergyConflict(['oat milk', 'banana'], ['dairy'])).toBeNull();
    expect(findAllergyConflict(['almond milk', 'banana'], ['dairy'])).toBeNull();
  });

  it('still blocks a recipe with plant milk AND real milk for a dairy allergy', () => {
    expect(
      findAllergyConflict(['coconut milk', 'milk', 'rice'], ['dairy'])
    ).toEqual({ ingredient: 'milk', allergy: 'dairy' });
  });

  it('still blocks soy milk for a soy allergy, but not for a dairy allergy', () => {
    expect(findAllergyConflict(['soy milk', 'sugar'], ['soy'])).toEqual({
      ingredient: 'soy milk',
      allergy: 'soy',
    });
    expect(findAllergyConflict(['soy milk', 'sugar'], ['dairy'])).toBeNull();
  });
});
