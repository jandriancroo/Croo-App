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

self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification clicked:', event);
  
  event.notification.close();
  
  const data = event.notification.data || {};
  let url = '/';
  
  // Route based on notification type
  const chatId = data.chat_id || data.chatId;
  const checklistId = data.checklist_id || data.checklistId;
  
  if ((data.type === 'chat' || data.type === 'announcement' || data.type === 'chat_message') && chatId) {
    url = `/messages?chat=${chatId}`;
  } else if ((data.type === 'checklist' || data.type === 'overdue_checklist') && checklistId) {
    url = `/complete/${checklistId}`;
  } else if (data.type === 'alert' || data.type === 'late_arrival') {
    url = '/alerts';
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Check if there's already a window open
      for (let client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open a new window if none exists
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

console.log('[SW] Push handler loaded');
