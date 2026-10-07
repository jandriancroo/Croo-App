// THE one place a tapped push decides where to open. public/sw-push.js mirrors these
// rules inline (it can't import) — keep the two in sync.
export function isSafeInAppPath(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !/^\/*[a-z][a-z0-9+.-]*:/i.test(url);
}

export function resolvePushRoute(data: Record<string, any> | null | undefined): string | null {
  if (!data) return null;
  const type = data.type || data.notification_type;
  const url = data.url;

  // a0. A manager's nudge: checklist -> that checklist (the one exception to rule a); task/event -> its alert card.
  if (type === 'quick_nudge' || type === 'checklist_nudge') {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const nid = data.notification_id;
    const cid = data.target_type === 'checklist' ? data.target_id : data.checklist_id;
    if ((data.target_type === 'checklist' || data.checklist_id) && typeof cid === 'string' && uuid.test(cid)) return '/complete/' + cid;
    if ((data.target_type === 'task' || data.target_type === 'event') && nid) return `/?alert=${encodeURIComponent(nid)}`;
  }
  // a. Checklist family always opens the dashboard (never deep-links into a checklist).
  if (type === 'overdue_checklist' || type === 'overdue_checklists' || type === 'checklist' || type === 'monthly_checklist') return '/dashboard';
  if (typeof url === 'string' && url.startsWith('/complete')) return '/dashboard';

  // b. Quick tasks -> visual alert stack on the dashboard.
  const alertId = data.notification_id || data.visual_alert_id;
  if ((type === 'alarm_task' || type === 'quick_task') && alertId) return `/?alert=${encodeURIComponent(alertId)}`;

  // c. Explicit safe in-app url.
  if (isSafeInAppPath(url)) return url;

  const chatId = data.chat_id || data.chatId;
  const postId = data.post_id || data.postId;

  // d. Team Feed post.
  if (postId && (type === 'announcement' || type === 'feed_post' || type === 'feed_comment' || !chatId)) {
    return `/messages?post=${encodeURIComponent(postId)}`;
  }

  // e. Any chat.
  if (chatId) return `/messages?chat=${encodeURIComponent(chatId)}`;

  // f. Alerts.
  if (type === 'alert' || type === 'late_arrival') return '/alerts';

  // g. Stay where the app is.
  return null;
}
