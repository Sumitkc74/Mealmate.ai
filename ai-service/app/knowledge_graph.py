"""Culinary Knowledge Graph and Substitution Engine.

Models ingredients, culinary taxonomy, flavor pairings, allergen hierarchies,
and context-aware ingredient substitutions (e.g. baking vs. savoury cooking,
vegan alternatives, gluten-free swaps).

Provides:
- Graph-based traversal for direct and multi-hop substitutions with ratios.
- Allergen ontology expansion (e.g. 'dairy' -> butter, cheese, yogurt, whey).
- Flavor pairing complements based on culinary chemistry.
- Graph-augmented retrieval (GraphRAG) metadata injection.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any


@dataclass(frozen=True)
class Substitution:
    target: str
    substitute: str
    ratio: str
    context: str  # "general", "baking", "savoury", "vegan", "dairy-free", "gluten-free"
    notes: str


@dataclass
class IngredientNode:
    name: str
    category: str  # "dairy", "produce", "allium", "protein", "grain", "fat", "acid", "spice"
    allergens: list[str] = field(default_factory=list)
    flavors: list[str] = field(default_factory=list)
    functional_roles: list[str] = field(default_factory=list)  # "emulsifier", "acid", "binder", "thickener"
    complements: list[str] = field(default_factory=list)
    substitutions: list[Substitution] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Knowledge Base Seed
# ---------------------------------------------------------------------------

_CORE_INGREDIENTS: dict[str, dict[str, Any]] = {
    "buttermilk": {
        "category": "dairy",
        "allergens": ["dairy"],
        "flavors": ["acidic", "tangy", "creamy"],
        "functional_roles": ["acid", "tenderizer", "leavener_activator"],
        "complements": ["blueberry", "cornmeal", "fried chicken", "pancake"],
        "substitutions": [
            Substitution("buttermilk", "milk + 1 tbsp lemon juice or white vinegar", "1:1", "baking", "Let sit for 5 minutes until curdled."),
            Substitution("buttermilk", "plain yogurt + water/milk (3:1)", "1:1", "general", "Whisk until smooth."),
            Substitution("buttermilk", "soy milk + 1 tbsp apple cider vinegar", "1:1", "vegan", "Vegan/dairy-free equivalent for baking."),
        ],
    },
    "egg": {
        "category": "protein",
        "allergens": ["eggs"],
        "flavors": ["rich", "savory"],
        "functional_roles": ["binder", "emulsifier", "leavener"],
        "complements": ["cheese", "bacon", "toast", "avocado", "spinach"],
        "substitutions": [
            Substitution("egg", "1 tbsp ground flaxseed + 3 tbsp water", "1 egg : 1 tbsp flax mix", "vegan", "Mix and let gel 5 min; ideal for quick breads & pancakes."),
            Substitution("egg", "1/4 cup unsweetened applesauce", "1 egg : 1/4 cup", "baking", "Adds moisture; best in muffins and cakes."),
            Substitution("egg", "1/4 cup silken tofu", "1 egg : 1/4 cup", "baking", "Dense, moist texture for brownies."),
            Substitution("egg", "1/4 cup aquafaba (chickpea liquid)", "1 egg : 3 tbsp", "vegan", "Whips like egg whites for meringues and batters."),
        ],
    },
    "butter": {
        "category": "fat",
        "allergens": ["dairy"],
        "flavors": ["rich", "creamy", "savory", "sweet"],
        "functional_roles": ["fat_source", "flavor_carrier", "flakiness"],
        "complements": ["garlic", "herb", "potato", "bread", "mushroom"],
        "substitutions": [
            Substitution("butter", "olive oil", "1:0.75", "savoury", "Great for sauteing and dressings; reduce volume by 25%."),
            Substitution("butter", "coconut oil", "1:1", "vegan", "Solid at room temp; works well in pie crusts and cookies."),
            Substitution("butter", "mashed avocado", "1:1", "vegan", "Adds moisture and healthy fats in chocolate baking."),
            Substitution("butter", "ghee", "1:1", "lactose-free", "Clarified butter, virtually free of milk solids."),
        ],
    },
    "heavy cream": {
        "category": "dairy",
        "allergens": ["dairy"],
        "flavors": ["creamy", "rich", "sweet"],
        "functional_roles": ["thickener", "fat_source", "emulsifier"],
        "complements": ["coffee", "strawberry", "parmesan", "soup"],
        "substitutions": [
            Substitution("heavy cream", "canned full-fat coconut milk", "1:1", "vegan", "Chill can and scoop solid cream for whipping."),
            Substitution("heavy cream", "3/4 cup milk + 1/4 cup melted butter", "1:1", "general", "Provides matching fat ratio for cooking sauces."),
            Substitution("heavy cream", "blended soaked cashews + water", "1:1", "vegan", "Neutral, velvety cream for soups and pastas."),
        ],
    },
    "soy sauce": {
        "category": "condiment",
        "allergens": ["soy", "gluten"],
        "flavors": ["umami", "salty", "fermented"],
        "functional_roles": ["flavor_enhancer", "salting_agent"],
        "complements": ["ginger", "garlic", "scallion", "tofu", "rice", "salmon"],
        "substitutions": [
            Substitution("soy sauce", "tamari", "1:1", "gluten-free", "Naturally brewed gluten-free Japanese soy sauce."),
            Substitution("soy sauce", "coconut aminos", "1:1", "soy-free", "Lower sodium, slightly sweeter, free from soy and wheat."),
            Substitution("soy sauce", "Worcestershire sauce + splash water", "1:1", "savoury", "Rich umami profile for marinades."),
        ],
    },
    "parmesan cheese": {
        "category": "dairy",
        "allergens": ["dairy"],
        "flavors": ["umami", "salty", "nutty", "sharp"],
        "functional_roles": ["flavor_enhancer", "thickener"],
        "complements": ["basil", "tomato", "pasta", "garlic", "olive oil"],
        "substitutions": [
            Substitution("parmesan cheese", "nutritional yeast", "1:0.75", "vegan", "Cheesy, savory, vitamin-rich flakes."),
            Substitution("parmesan cheese", "pecorino romano", "1:1", "sheep-dairy", "Saltier and sharper, made from sheep's milk."),
            Substitution("parmesan cheese", "toasted ground cashews + salt + garlic powder", "1:1", "vegan", "Textured vegan crumb topping."),
        ],
    },
    "all-purpose flour": {
        "category": "grain",
        "allergens": ["gluten", "wheat"],
        "flavors": ["neutral"],
        "functional_roles": ["binder", "thickener", "structure"],
        "complements": ["butter", "sugar", "yeast", "milk"],
        "substitutions": [
            Substitution("all-purpose flour", "1:1 gluten-free baking blend (with xanthan gum)", "1:1", "gluten-free", "Direct drop-in for cookies and cakes."),
            Substitution("all-purpose flour", "oat flour (certified gluten-free)", "1:1", "gluten-free", "More tender crumb; denser texture."),
            Substitution("all-purpose flour", "almond flour", "1:0.75", "low-carb", "Moister, requires extra egg or binder."),
        ],
    },
    "garlic": {
        "category": "allium",
        "allergens": [],
        "flavors": ["pungent", "savory", "sweet_when_roasted"],
        "functional_roles": ["aromatic_base"],
        "complements": ["onion", "olive oil", "tomato", "ginger", "rosemary", "parmesan"],
        "substitutions": [
            Substitution("garlic", "1/8 tsp garlic powder per clove", "1 clove : 1/8 tsp", "shelf-stable", "Concentrated dried form."),
            Substitution("garlic", "asafoetida (hing) pinch", "1 clove : 1 pinch", "low-fodmap", "Traditional Ayurvedic allium substitute."),
            Substitution("garlic", "garlic-infused olive oil", "1 clove : 1 tbsp oil", "low-fodmap", "FODMAP-friendly garlic aroma."),
        ],
    },
    "tomato": {
        "category": "produce",
        "allergens": ["nightshades"],
        "flavors": ["acidic", "sweet", "umami"],
        "functional_roles": ["acid", "body", "color"],
        "complements": ["basil", "mozzarella", "garlic", "oregano", "olive oil"],
        "substitutions": [
            Substitution("tomato", "roasted red pepper puree", "1:1", "nightshade-alternative", "Sweet, vibrant sauce base without tomatoes."),
            Substitution("tomato", "nomato sauce (carrots, beets, garlic, vinegar)", "1:1", "nightshade-free", "Traditional nightshade-free autoimmune protocol sauce."),
        ],
    },
    "sour cream": {
        "category": "dairy",
        "allergens": ["dairy"],
        "flavors": ["tangy", "creamy", "acidic"],
        "functional_roles": ["fat_source", "tenderizer"],
        "complements": ["potato", "chives", "taco", "chili"],
        "substitutions": [
            Substitution("sour cream", "plain Greek yogurt", "1:1", "high-protein", "Identical texture and tang with more protein and less fat."),
            Substitution("sour cream", "cashew cream + lemon juice", "1:1", "vegan", "Dairy-free tangy cashew cream."),
        ],
    },
}

_ALLERGEN_HIERARCHY: dict[str, set[str]] = {
    "dairy": {
        "milk", "butter", "cheese", "yogurt", "cream", "sour cream",
        "heavy cream", "buttermilk", "ghee", "casein", "whey", "ricotta",
        "parmesan", "mozzarella", "cheddar", "brie", "feta"
    },
    "gluten": {
        "wheat", "flour", "all-purpose flour", "bread", "pasta", "barley",
        "rye", "couscous", "bulgur", "soy sauce", "seitan", "semolina"
    },
    "soy": {
        "soy sauce", "tofu", "tempeh", "edamame", "miso", "soy milk",
        "tamari", "soy lecithin"
    },
    "nuts": {
        "almond", "walnut", "cashew", "pecan", "pistachio", "macadamia",
        "peanut", "peanut butter", "hazelnut"
    },
    "eggs": {
        "egg", "egg yolk", "egg white", "mayonnaise", "meringue"
    },
    "fish": {
        "salmon", "tuna", "cod", "anchovy", "fish sauce", "tilapia", "trout"
    },
    "shellfish": {
        "shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop"
    },
}


class CulinaryKnowledgeGraph:
    """In-memory Knowledge Graph for culinary entities and substitutions."""

    def __init__(self) -> None:
        self._nodes: dict[str, IngredientNode] = {}
        self._allergen_map: dict[str, set[str]] = dict(_ALLERGEN_HIERARCHY)
        self._load_seed_data()

    def _load_seed_data(self) -> None:
        for name, data in _CORE_INGREDIENTS.items():
            node = IngredientNode(
                name=name,
                category=data.get("category", "produce"),
                allergens=data.get("allergens", []),
                flavors=data.get("flavors", []),
                functional_roles=data.get("functional_roles", []),
                complements=data.get("complements", []),
                substitutions=data.get("substitutions", []),
            )
            self._nodes[name] = node

    def get_node(self, ingredient: str) -> IngredientNode | None:
        """Find node by exact or partial ingredient name."""
        key = ingredient.lower().strip()
        if key in self._nodes:
            return self._nodes[key]
        for name, node in self._nodes.items():
            if name in key or key in name:
                return node
        return None

    def find_substitutes(
        self,
        ingredient: str,
        context: str | None = None,
        avoid_allergens: list[str] | None = None,
    ) -> list[Substitution]:
        """Query substitutions for an ingredient with optional context/allergen filters."""
        node = self.get_node(ingredient)
        if not node:
            return []

        results: list[Substitution] = []
        avoid = {a.lower().strip() for a in (avoid_allergens or [])}

        for sub in node.substitutions:
            if context and context.lower() not in sub.context.lower() and sub.context != "general":
                continue
            # Check if substitute has known avoided allergens
            sub_name_lower = sub.substitute.lower()
            violates = False
            for allergen in avoid:
                if allergen in sub_name_lower:
                    violates = True
                    break
                # Check allergen ontology
                expanded = self._allergen_map.get(allergen, set())
                if any(bad in sub_name_lower for bad in expanded):
                    violates = True
                    break
            if not violates:
                results.append(sub)

        return results

    def get_flavor_complements(self, ingredient: str) -> list[str]:
        """Return culinary flavor complements (pairings) for an ingredient."""
        node = self.get_node(ingredient)
        return node.complements if node else []

    def expand_allergens(self, user_allergies: list[str]) -> set[str]:
        """Expand user allergy terms (e.g. 'dairy') into concrete ingredient terms."""
        expanded: set[str] = set()
        for allergy in user_allergies:
            norm = allergy.lower().strip()
            expanded.add(norm)
            if norm in self._allergen_map:
                expanded.update(self._allergen_map[norm])
        return expanded

    def enrich_recipe(self, recipe: dict[str, Any]) -> dict[str, Any]:
        """Augment recipe metadata with knowledge graph tags, functional roles, and pairings."""
        ingredients: list[str] = recipe.get("ingredients", [])
        roles: set[str] = set()
        flavors: set[str] = set()
        pairings: set[str] = set()

        for ing in ingredients:
            node = self.get_node(ing)
            if node:
                roles.update(node.functional_roles)
                flavors.update(node.flavors)
                pairings.update(node.complements)

        enriched = dict(recipe)
        enriched["kg_functional_roles"] = sorted(roles)
        enriched["kg_flavor_profiles"] = sorted(flavors)
        enriched["kg_recommended_pairings"] = sorted(pairings)[:6]
        return enriched

    def get_summary(self) -> dict[str, Any]:
        """Return Knowledge Graph topology metrics."""
        total_substitutions = sum(len(n.substitutions) for n in self._nodes.values())
        return {
            "node_count": len(self._nodes),
            "edge_count_substitutions": total_substitutions,
            "allergen_classes": len(self._allergen_map),
            "sample_ingredients": list(self._nodes.keys())[:5],
        }


@lru_cache(maxsize=1)
def get_knowledge_graph() -> CulinaryKnowledgeGraph:
    """Return Knowledge Graph singleton instance."""
    return CulinaryKnowledgeGraph()

