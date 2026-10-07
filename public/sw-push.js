// Custom push notification handler for service worker

self.addEventListener('push', function(event) {
  console.log('[SW] Push event received:', event);
  
  let data = {};
  
  if (event.data) {
    try {
      data = event.data.json();
      console.log('[SW] Push data:', data);
    } catch (e) {
      console.log('[SW] Push data (text):', event.data.text());
      data = { title: 'New Notification', body: event.data.text() };
    }
  }
  
  const title = data.title || 'CrooHQ';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/notification-icon.png',
    badge: '/notification-icon-monochrome.png',
    tag: data.tag || 'croo-notification',
    data: data.data || {}
  };
  
  console.log('[SW] Showing notification:', title, options);
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Push-only service worker (no fetch handler): take control right away so
// notification taps can talk to open windows.
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(event) { event.waitUntil(clients.claim()); });

// keep in sync with src/lib/pushRouting.ts
function crooIsSafePath(url) {
  return typeof url === 'string' && url.charAt(0) === '/' && url.indexOf('//') !== 0 && !/^\/*[a-z][a-z0-9+.-]*:/i.test(url);
}
function crooResolvePushRoute(data) {
  if (!data) return null;
  var type = data.type || data.notification_type;
  var url = data.url;
  if (type === 'quick_nudge' || type === 'checklist_nudge') {
    var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var nid = data.notification_id;
    var cid = data.target_type === 'checklist' ? data.target_id : data.checklist_id;
    if ((data.target_type === 'checklist' || data.checklist_id) && typeof cid === 'string' && uuid.test(cid)) return '/complete/' + cid;
    if ((data.target_type === 'task' || data.target_type === 'event') && nid) return '/?alert=' + encodeURIComponent(nid);
  }
  if (type === 'overdue_checklist' || type === 'overdue_checklists' || type === 'checklist' || type === 'monthly_checklist') return '/dashboard';
  if (typeof url === 'string' && url.indexOf('/complete') === 0) return '/dashboard';
  var alertId = data.notification_id || data.visual_alert_id;
  if ((type === 'alarm_task' || type === 'quick_task') && alertId) return '/?alert=' + encodeURIComponent(alertId);
  if (crooIsSafePath(url)) return url;
  var chatId = data.chat_id || data.chatId;
  var postId = data.post_id || data.postId;
  if (postId && (type === 'announcement' || type === 'feed_post' || type === 'feed_comment' || !chatId)) {
    return '/messages?post=' + encodeURIComponent(postId);
  }
  if (chatId) return '/messages?chat=' + encodeURIComponent(chatId);
  if (type === 'alert' || type === 'late_arrival') return '/alerts';
  return null;
}

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var route = crooResolvePushRoute(event.notification.data || {});
  var url = route || '/';

  event.waitUntil((async function() {
    var list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    var client = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) { client = list[i]; break; }
    }
    if (!client) {
      if (clients.openWindow) return clients.openWindow(url);
      return;
    }
    try { await client.focus(); } catch (e) {}
    if (typeof client.postMessage === 'function') {
      // route null = just resume where the app is (window refreshes its chat/feed)
      client.postMessage({ type: 'CROO_PUSH_NAVIGATE', url: route });
      return;
    }
    if (!route) return;
    try {
      await client.navigate(url);
    } catch (e) {
      if (clients.openWindow) return clients.openWindow(url);
    }
  })());
});

console.log('[SW] Push handler loaded');
