# Playbook Library — Implementation Plan

A searchable knowledge/recipe portal that lives inside the **Logs** page as a new section ("Library"), scoped either to a **Brand** or an **Organization**, with a lightweight recipe builder, reusable ingredient repository, and cross-recipe linking.

---

## 1. Placement & Navigation

- Add a **Library** tab/section on the existing `LogBook.tsx` page (no new top-level nav item).
- Inside Library, a scope switcher shows two subsections when both are enabled:
  - **Brand Library** — visible to everyone at any location under the brand.
  - **Org Library** — visible to everyone in the organization.
- If only one scope is enabled, no switcher — just that library.

## 2. Enabling the Library

- On the **Brand Settings** page (Edit Brand dialog), add a new section: **Library**
  - Checkbox: **Enable Brand Library** — content authored once per brand, visible to all orgs/locations under it. Editable only by `brand_admin` + `super_admin`.
  - Checkbox: **Enable Org Library** — each organization under the brand gets its own library. Editable only by `org_admin` and above.
- Both can be enabled independently.

## 3. Permissions

| Action | Brand Library | Org Library |
|---|---|---|
| View | Anyone in brand | Anyone in org |
| Create / Edit / Delete | `brand_admin`, `super_admin` | `org_admin`, `brand_admin`, `super_admin` |

Enforced in RLS and reflected in UI (edit buttons hidden for non-editors).

## 4. Content Types

Two document types in a unified searchable index:

**A. Document** — uploaded PDF/image or rich-text page (SOPs, training, allergen sheets).

**B. Recipe** — structured builder:
- Title, description, photo, tags, category
- **Ingredient list** — each row: `ingredient_id` (from repository) + `quantity` + `unit`
- Steps (ordered rich text)
- **Recipe links** — tag other recipes; render as clickable chips that open a stacked preview overlay above the current page

## 5. Ingredient Repository

- New table `library_ingredients` scoped to the same brand/org as its parent library.
- When creating a recipe, ingredient field is a **searchable combobox**: pick existing or type new → new ingredients auto-created on save.
- Ingredients page (admin-only) to rename, merge, or archive.
- Not linked to `inventory_items` for now (deliberate — Library is standalone).

## 6. Search & Indexing

- Full-text search across title, description, tags, steps, ingredient names, and document text.
- Postgres `tsvector` column on `library_documents` with a GIN index; updated via trigger on insert/update.
- Frontend: debounced search box at top of Library; results grouped by type (Recipes / Documents).
- Ingredients also searchable within the recipe builder combobox.

## 7. Recipe Viewer

- Clean read-mode layout optimized for prep cooks on mobile — big type, photo hero, ingredient table, numbered steps.
- Tapping a linked recipe chip opens it as a **stacked sheet** over the current viewer (Radix Dialog on top of Dialog) — closing returns to the original recipe.

## 8. Technical Details

### New Tables (all in `public`)

```text
library_settings          — brand_id, org_id, brand_library_enabled, org_library_enabled
library_documents         — id, scope ('brand'|'org'), brand_id, org_id, type ('recipe'|'document'),
                            title, description, body (jsonb), photo_url, file_url, tags text[],
                            category, search_tsv (tsvector), created_by, updated_at
library_ingredients       — id, scope, brand_id, org_id, name (unique per scope), created_by
library_recipe_ingredients— recipe_id, ingredient_id, quantity numeric, unit text, sort_order
library_recipe_links      — from_recipe_id, to_recipe_id
```

- GRANT statements + RLS on every table (per project standards).
- GIN index on `search_tsv` and `tags`.
- Trigger to keep `search_tsv` current.

### Frontend Files

```text
src/pages/LogBook.tsx                            — add "Library" tab
src/components/library/LibraryPanel.tsx          — scope switcher + search + list
src/components/library/RecipeBuilder.tsx         — create/edit recipe
src/components/library/RecipeViewer.tsx          — read view with stacked links
src/components/library/DocumentUploader.tsx      — upload PDFs/images
src/components/library/IngredientCombobox.tsx    — searchable + create-on-fly
src/components/library/LibraryEnableSection.tsx  — inside Brand Settings edit dialog
src/hooks/useLibrary.ts                          — queries + mutations
```

### Storage

- New `library-assets` bucket (private) for recipe photos and uploaded documents. RLS via signed URLs.

## 9. Out of Scope (for now)

- Kiosk / shared-device mode
- Sub-recipes / nested recipes (only flat ingredient lists + link-to-recipe chips)
- Inventory integration (no `brand_item_id` linking yet — can layer on later)
- Version history / draft workflow

---

## Build Order

1. Migration: tables, GRANTs, RLS, tsvector trigger, storage bucket.
2. Brand Settings toggle UI.
3. Library tab shell inside LogBook + scope switcher + search.
4. Ingredient repository + combobox.
5. Recipe builder + viewer + stacked link preview.
6. Document upload + viewer.
7. Search wiring end-to-end.

Approve and I'll start with the migration.