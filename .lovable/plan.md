
# Theo Upgrade Plan

## Phase 1: Immediate (This Session)

### 1A. System Prompt Overhaul
- Replace current personality prompt with the elite "Digital GM / Co-Pilot" persona
- Keep all existing tool-calling logic, formatting rules, and safety guards intact
- Add SOP/knowledge-base awareness instructions

### 1B. Long-Term Memory System ("Theo's Brain")
- **Database**: Create `theo_knowledge` table with `location_id`, `topic`, `content`, and `embedding` (pgvector)
- **Save Button**: Add a "Pin to Memory" button next to Theo's responses
- **Embedding**: When pinned, call Lovable AI to generate an embedding and store it
- **Retrieval**: Before each query, do a similarity search on `theo_knowledge` and inject top 3 relevant facts into context
- **Edge Function**: Add a `theo-memory` edge function to handle save + search

### 1C. System Prompt: Employee Tag Format
- Switch from `[[employee:Name]]` to `<employee>Name</employee>` tags as requested (update markdown renderer too)

## Phase 2: Coverage Assessment for 50 Questions

### ✅ Already Supported (Theo can answer these TODAY with existing tools)
- Questions 1-5, 7, 9 (Sales/Labor via `query_sales`, `query_labor`)
- Questions 11-14, 16-19 (Ovation via `query_ovation_reviews`)
- Questions 21-22, 24, 29-30 (Schedule/Punches via `query_schedule`, `query_labor`)
- Questions 41-49 (Checklists, tasks, logbook, catering via existing tools)

### ⚠️ Partially Supported (need minor tool tweaks)
- Q5 "cut one person" — needs labor projection logic (complex, future)
- Q6 "overtime across brand" — needs cross-location query (org-level)
- Q20 "auto-flag reviews" — needs task-creation tool (new)
- Q27 "which SM had highest labor%" — needs shift-level labor correlation
- Q44 "create a temporary task" — needs task-creation tool (new)
- Q50 "shift-readiness report" — composite query across multiple tools

### ❌ Needs New Data Sources (not available in your system yet)
- Q7, Q10 (KDS ticket times, discounts/comps — not in sales_cache)
- Q8 (Catering vs Walk-in split — not tracked separately in POS data)
- Q23 (I-9 documents — no HR document tracking table)
- Q25 (OPUS training data — no integration exists)
- Q31-39 (Recipe database, prep pars, shelf life, ingredient impact — no recipe/COGS tables yet)

## Recommendation
Start with **Phase 1** now (prompt + memory + tag format). The 50-question coverage is mostly already there — the gaps are data sources that don't exist yet, not Theo limitations. We can add task-creation as a new tool in this session too.

**Proceed with Phase 1?**
