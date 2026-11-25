/**
 * Client-side mirror of the server allergen hierarchy
 * (`server/src/utils/allergens.ts`, itself a mirror of the ai-service
 * `ai-service/app/knowledge_graph.py` `_ALLERGEN_HIERARCHY`).
 *
 * The planner needs the same group → ingredient expansion the server uses
 * to screen the AI assistant's adds, so a manual add can be warned about
 * before it lands in a slot. Keep the three in sync: this file must not
 * invent allergen groups beyond what the ai-service hierarchy defines,
 * and any entry added or removed there should be mirrored here and on
 * the server.
 */

/**
 * Allergen group → concrete ingredient terms, copied verbatim from the
 * ai-service `_ALLERGEN_HIERARCHY`. Keys and entries are lowercase.
 */
export const ALLERGEN_HIERARCHY: Record<string, readonly string[]> = {
  dairy: [
    'milk', 'butter', 'cheese', 'yogurt', 'cream', 'sour cream',
    'heavy cream', 'buttermilk', 'ghee', 'casein', 'whey', 'ricotta',
    'parmesan', 'mozzarella', 'cheddar', 'brie', 'feta',
  ],
  gluten: [
    'wheat', 'flour', 'all-purpose flour', 'bread', 'pasta', 'barley',
    'rye', 'couscous', 'bulgur', 'soy sauce', 'seitan', 'semolina',
  ],
  soy: [
    'soy sauce', 'tofu', 'tempeh', 'edamame', 'miso', 'soy milk',
    'tamari', 'soy lecithin',
  ],
  nuts: [
    'almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'macadamia',
    'peanut', 'peanut butter', 'hazelnut',
  ],
  eggs: ['egg', 'egg yolk', 'egg white', 'mayonnaise', 'meringue'],
  fish: [
    'salmon', 'tuna', 'cod', 'anchovy', 'fish sauce', 'tilapia', 'trout',
  ],
  shellfish: [
    'shrimp', 'prawn', 'crab', 'lobster', 'clam', 'mussel', 'oyster', 'scallop',
  ],
};

/**
 * Expand saved allergy terms (e.g. 'dairy') into concrete ingredient terms,
 * mirroring `CulinaryKnowledgeGraph.expand_allergens` in the ai-service.
 * A term that is not a hierarchy group expands to itself only.
 */
export function expandAllergies(allergies: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const allergy of allergies ?? []) {
    const norm = allergy.toLowerCase().trim();
    if (!norm) continue;
    expanded.add(norm);
    for (const term of ALLERGEN_HIERARCHY[norm] ?? []) {
      expanded.add(term);
    }
  }
  return expanded;
}

/**
 * Normalise an ingredient / allergen term for matching: lowercase, split
 * on non-alphanumerics, and strip a trailing 's' so plurals ('eggs') match
 * singular terms ('egg'). Returns a space-padded string so whole-word
 * phrase matching is a plain `includes` check.
 */
function normaliseForMatch(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 2 && w.endsWith('s') ? w.slice(0, -1) : w));
  return ` ${words.join(' ')} `;
}

/** True when the ingredient name contains the allergen term as a whole word or phrase. */
function ingredientMatches(ingredientName: string, term: string): boolean {
  return normaliseForMatch(ingredientName).includes(normaliseForMatch(term));
}

export interface AllergyConflict {
  /** The recipe ingredient name, as stored on the recipe. */
  ingredient: string;
  /** The saved allergy term it violates, as the user saved it. */
  allergy: string;
}

/**
 * Find the first ingredient that violates one of the user's saved allergies.
 * Returns `null` when nothing conflicts. Matching is whole-word based, so
 * 'eggplant' does not falsely match an 'egg' allergy, while 'parmesan
 * cheese' still matches both 'parmesan' and 'cheese'.
 */
export function findAllergyConflict(
  ingredientNames: string[],
  allergies: string[]
): AllergyConflict | null {
  if (!allergies?.length || !ingredientNames?.length) return null;
  const expanded = expandAllergies(allergies);
  for (const ingredient of ingredientNames) {
    if (!ingredient) continue;
    for (const term of expanded) {
      if (ingredientMatches(ingredient, term)) {
        // Report the saved allergy the user recognises, not the expanded term.
        const allergy =
          allergies.find((a) => {
            const norm = a.toLowerCase().trim();
            return norm === term || (ALLERGEN_HIERARCHY[norm] ?? []).includes(term);
          }) ?? term;
        return { ingredient, allergy };
      }
    }
  }
  return null;
}
