
## Clone Location Settings Tool

**Location:** Super Admin Settings page (new section)

### UI Flow
1. **Source Location Picker** — dropdown to select the location to clone FROM
2. **Template Type Checkboxes** — select which settings to copy:
   - ☑ Shift Templates (with positions)
   - ☑ Checklists (with all items, role tags, and settings)
   - ☑ Logbook Categories
   - ☑ Writeup Reasons
3. **Target Location Picker** — multi-select for destination locations (scoped to all locations the super admin has access to, with org grouping)
4. **"Clone Settings" button** — executes all selected copies in parallel
5. **Results summary** — shows what was copied and any conflicts (e.g., duplicate checklist titles get soft-replaced per existing standards)

### Clone Logic Per Type
- **Shift Templates**: Copy all templates from source, matching by name. Skip duplicates. Positions are org-scoped so they'll be auto-inserted into target org's `organization_positions` if missing.
- **Checklists**: Full deep copy — checklist → items → role tags. Existing matching titles get deactivated (soft replace pattern per existing standards).
- **Logbook Categories**: Copy categories with display_order. Skip if name already exists at target.
- **Writeup Reasons**: Copy reasons with display_order. Skip if reason text already exists at target.

### Access Control
- Super Admin only (checked via `is_super_admin()`)
- All operations use authenticated Supabase client (RLS enforced)

### Files to Create/Modify
1. **New:** `src/components/settings/CloneLocationSettings.tsx` — main UI component
2. **New:** `src/hooks/useCloneLocationSettings.ts` — clone logic hook
3. **Modify:** Super Admin settings page to add the new section
