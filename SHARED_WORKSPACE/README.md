<!--
SHARED WORKSPACE — cross-session reference for Jordan + Lovable + Claude.

Convention for every MD file in this tree:
  - Entries are dated and attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
  - Each item has STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
  - Newest entries at top
  - Never delete old entries — strike-through (~~text~~) or mark "SUPERSEDED by <link>"
    so history is preserved (same archive-don't-delete discipline as the data)
-->

# Shared Workspace

Single source of truth that survives across chat sessions. Read before deriving context from scratch.

## Layout

```
/SHARED_WORKSPACE/
  inventory/           # operator-facing inventory pages, counting, AvT
  brand_inventory/     # brand catalog, templates, pack configs, deploy cascade
  dashboard/           # org + location dashboards
  _tickets/            # cross-cutting open work (one MD per ticket)
```

Add new product-page subfolders as topics surface. Keep tickets in `_tickets/` until they're scoped to a single page, then move + leave a stub.

## File header convention

Every MD file starts with the HTML comment block shown at the top of this README so the rules travel with the file even if it's opened in isolation.
