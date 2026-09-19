# Chat page magazine feed and inbox switcher

## Scope
- Restyle existing feed cards without changing post data, permissions, ordering, or interactions.
- Replace the inbox arrow pager with a role-aware segmented control while keeping each existing inbox source and query separate.

## Feed cards
- Use `pinned` as the only band-color decision: orange for pinned posts and a thinner teal treatment for regular posts.
- Keep the existing announcement, badge, and channel labels; arrange them cleanly within the new header area.
- Keep author details, time, pin indicator, actions, reactions, comment count, seen count, attachments, and nested comments working as they do now.
- Split the existing body for display only: first line, or approximately the first 60 characters at a word boundary, becomes a bold headline; all remaining text renders directly below at normal weight with no content loss.
- Place image media full-width directly below the band/header treatment while retaining the current lightbox and multi-image behavior.
- Apply the established teal, orange, cream, and white brand roles through semantic theme styling.

## Inbox panel
- Preserve the current right-side desktop sheet and 92%-height mobile bottom sheet.
- Preserve the existing Direct messages, Hiring, and Support data sources and role rules.
- Replace previous/next arrows and progress marks with one segmented control listing only role-authorized sources.
- Hide the segmented control entirely when Direct messages is the user’s only available source.
- Preserve chat search, new-chat creation, pinning, deep links, unread states, and each detail view.

## Validation and review handoff
- Check desktop and mobile layouts, including pinned/regular posts, photo posts, nested comments, single-source users, and multi-source managers/admins.
- Confirm no data, permission, query, or overlay behavior changed.
- Provide a PR-style diff summary and clearly flag the headline split as the only presentation judgment implemented from the approved rules for Claude Level 2 review.
