# Phase 5 — Punch pass: STEP 0 report (nothing built)

No files changed. Key sizes are from the code. I did not measure the keypad in a browser at 1024x768, 820x1180 or 390 because the kiosk needs a device session. Measuring it is the first build step, before anything else changes.

## Headline findings
- The keypad is already big: 64px tall keys with 8px gaps. The plan keeps them at 64px or larger.
- The phone Schedule icon row (MobileScheduleView ~880-960) **never shows**. It only renders on the staff screen, and it only shows for managers and up, so nobody sees it. Every button in it is now covered by the split button in the title or by the manager screen's own controls.
- The controls under 44px are all on the kiosk side: the light/dark toggle (36px), the pager dots (8px), the small X buttons, the "Team tasks" pill and the manager dashboard's cut buttons (24-36px).
- `ThemeModePill` isn't used anywhere. Nothing imports it.

## 1. Every control, mapped

Shared sizes: default 44, sm 40, lg 48, icon 44 round, xs 32 (+44 tap), icon-sm 32 (+44 tap). Kiosk rule: never under 44, so xs and icon-sm are not used on kiosk files.

### pages/PunchClock.tsx
| Line | Control | Now | Map to |
|---|---|---|---|
| 1783 | Keypad 1-9 | lg + h-16 (64px), rounded-xl | keep 64px; drop the dark-mode hardcoded colors for theme tokens |
| 1793 | Clear key | lg + h-16 | keep 64px |
| 1801 | 0 key | lg + h-16 | keep 64px |
| 1809 | Backspace key | lg + h-16 | keep 64px |
| 1838, 1934 | SwipePagerHint (dots) | see below | see below |
| 1846 | ThemeToggleIcons | see below | see below |

### punchclock/ThemeToggleIcons.tsx
| 36, 51 | Sun / Moon round buttons | 36px | 44px round (icon size), keep custom (see 3) |

### punchclock/ThemeModePill.tsx
| 17, 28 | Day / Night text pills | ~22px | unused; leave alone (or delete later with sign-off) |

### punchclock/SwipePagerHint.tsx
| 50, 55 | Pager dots (punch / dashboard) | 8px tall | keep dot look, add invisible 44px tap area |

### punchclock/AlarmTaskOverlay.tsx
| 564 | Overlay action | h-12 (48) | lg |
| 635 | Back arrow | icon + h-12 w-12 (48) | keep 48 (larger than icon 44) |
| 737 | Big confirm | h-20 (80), text-2xl | keep as is |

### punchclock/QRTaskReportOverlay.tsx
| 226 | Close X | p-2 + 20px icon (~36) | 44px round (icon) |
| 297, 306 | Cancel / Submit | lg + h-14 (56) | keep 56 |

### punchclock/ShiftSummaryCard.tsx
| 231 | Header action | h-12 (48) | lg |
| 308 | Clock In | h-18 / py-6 (~72) | keep |
| 317 | Start/End break | ~72 | keep |
| 332, 340 | Break options | h-16 (64) | keep; swap amber/blue literals for tokens only if a token exists, else leave |
| 349 | End Shift | h-16 (64) | keep |
| 363 | Exit Punch Clock | h-12 (48) | lg |

### punchclock/PostClockInTasks.tsx
| 329 | Dismiss | default (44) | default, no change |

### punchclock/TeamTasksView.tsx
| 250 | Back arrow | icon (44) | no change |
| 284 | Task row | p-3 row (~56) | row, leave |
| 377 | Remove (in row) | sm (40) | default (44) |
| 444 | Back on overlay | icon + 48 | keep 48 |

### punchclock/PunchDeviceEntry.tsx
| 82 | Device entry card button | py-2 + 32px icon (~48) | row, leave |
| 122, 125 | Cancel / Save in dialog | default (44) | no change |

### punchclock/ManagerDashboardOverlay.tsx
| 1210 | Close hour detail X | 14px icon, no padding (~14) | 44px round (icon) |
| 1305 | Hour/person rows | px-3 py-2 (~40) | row; raise to min-h-11 |
| 1370 | Remove cut | sm + h-6 (24) | default height (44), text kept |
| 1377 | Cut minute chips | sm + h-9 (36) | sm (40) or default (44) — see risk |
| 1392 | Custom cut | sm + h-9 (36) | same as 1377 |
| 1407 | Save cuts | sm + h-9 full-width (36) | default (44) |
| 1466 | "Team tasks" pill | py-2 text-[11px] (~32) | default (44), keep pill shape |
| 1596, 1603 | Clear all / Apply | default (44) | no change |

### timeclock/QuickPunchDialog.tsx (crew-side dialog)
| 482 | Small text link | sm + h-6 (24) | default height (44) ghost; never xs here |
| 503 | Full-width action | default (44) | no change |
| 522 | Tiny icon | sm + h-6 w-6 (24) | icon (44) |
| 563 | Full-width sm | sm (40) | default (44) |
| 585, 588 | Cancel / Confirm | default (44) | no change |

### schedule/QuickPunchDialog.tsx (manager dialog)
| 297 | Icon | icon-sm (32 + 44 tap) | no change |
| 315 | Icon held in 2C | icon + h-9 w-9 (36) | icon-sm (32 + 44 tap), matching 297 next to it |
| 405 | Text link | xs | no change |
| 424 | Full-width action | default | no change |
| 498, 501 | Cancel / Confirm | default | no change |

## 2. Keypad
- Code today: 3 columns, gap-2 (8px), each key 64px tall, width = a third of the card. The card sits inside a two-part layout (photo + `p-8` keypad panel), so the width changes with the screen.
- PIN boxes: 44px squares, already fine.
- Plan: keys stay exactly 64px tall with 8px gaps. No size change. Only the dark-mode colors (`bg-neutral-700`, `text-white`) move to theme tokens, if they look the same in both modes. Otherwise they stay.
- First build step: measure real key width and height at 1024x768, 820x1180 and 390 before any edit, then again after.

## 3. Hand-made toggles
- **ThemeToggleIcons (sun/moon):** stays custom. It stops touch events from reaching the kiosk swipe pager, and SegmentedControl doesn't do that. Change: 36px → 44px buttons only.
- **ThemeModePill:** unused. Leave it.
- **SwipePagerHint dots:** stays custom. The dots show page position, so they aren't a tab switcher. Add a 44px invisible tap area only.
- **Team / tasks switch:** there's no tabbed switcher. "Team tasks" is a single button that opens an overlay, so it stays a button (44px).
- Nothing in scope becomes a SegmentedControl.

## 4. MobileScheduleView ~880-960 row
- It lives in `renderScheduleContent`, which only the staff (non-manager) branch renders (line 1471). The row is wrapped in "manager or higher". **Result: no one ever sees it**, at any width or day. The manager phone view has its own layout (line 1040 on).
- Duplicate check:
  - Build Schedule (LayoutGrid): duplicate. It's "Build Week" in the split button.
  - CalendarPlus (New Event): duplicate. It's "New Event" in the split button.
  - UserPlus (add shift sheet): duplicate. It's "New Shift" in the split button.
  - Print Day Timeline: not in the split button (that has Share PDF). It's unreachable anyway.
  - History: also on the manager view? Needs checking during build; unreachable here either way.
  - Undo, Publish/Update, LIVE: the manager view has its own Publish/LIVE in the NOW header (~1149-1169). Unreachable here.
- Recommendation for later (not this phase unless you say so): delete the row, since it's never shown. For this phase, leave it untouched. Resizing buttons nobody can see is wasted risk.

## 5. Risk
- **768-tall iPad landscape:** the kiosk card is `min-h-[600px]`, with clock, PIN boxes, 4 rows of 64px keys plus gaps (~280px) and the "Powered by" logo. The plan doesn't make anything taller there, so the keypad can't be pushed off screen. The ManagerDashboardOverlay cut chips going from 36 to 44 add about 8px per row. With many shifts that list scrolls already, but the Save button (1407) could move lower. Plan: use sm (40) for the chips if 44 pushes Save below the fold at 1024x768.
- **Punch logic:** none of these edits touch handlers, PIN entry, auto-submit at 4 digits, break rules or the Toast/Qu labor checks. ThemeToggleIcons' touch-stopping code stays exactly as is.
- **Theme tokens:** many kiosk colors are hard-coded (`neutral-*`, `white`, `slate-*`, amber/blue break buttons). Swapping them could shift the look in one mode. Plan: swap only where a token matches in both modes, and check both modes on screen. Otherwise leave them and list them.
- **Locked:** nothing here is in the dock, cubes, Edit Dashboard, inventory, toasts, support or Nudge files.

## Build order after "go"
1. Measure the keypad and overlays at 1024x768, 820x1180 and 390 in light and dark (before).
2. Apply the size changes from the tables above.
3. Measure again, and screenshot the kiosk keypad, ShiftSummaryCard and manager overlay in both modes.
4. Report files changed and before/after sizes.
