

## Rename Section Headers: "Base" → "Foundation", "Core Recipes" → "Build"

**Risk level: None** — pure display text swap, no logic involved.

### Change
**File:** `src/components/inventory/recipe-catalog/CatalogSection.tsx`
- Line ~101: `"Base"` → `"Foundation"`
- Line ~121: `"Core Recipes"` → `"Build"`

### What stays untouched
- Database `category` column values (`BASE`, `CORE`, `MI`, `PREP`)
- All sorting, composition, depletion, and POS mapping logic
- Recipe builder, variance reports, and all other systems that reference `category`

### Why it's safe
These are static strings inside `<p>` tags used only for visual section headers within the catalog accordion. No code anywhere references these display strings for logic.

