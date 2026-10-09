/* Service Worker ARKINA ADMIN — polling en arrière-plan toutes les 60 secondes */
const CACHE = 'arkina-admin-v3';
const SB_URL = "https://nsskercmbmgmdftcpatd.supabase.co";

/* État précédent (persiste tant que le SW vit) */
let _prev = { orders: -1, reviews: -1, messages: -1 };
let _token = null; /* JWT Supabase stocké par la page */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

/* La page envoie le token JWT à chaque connexion */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (e.data && e.data.type === 'SET_TOKEN') {
    _token = e.data.token;
    if (_token) checkNow(); /* vérifie immédiatement à la connexion */
  }
  if (e.data && e.data.type === 'RESET') {
    _prev = { orders: -1, reviews: -1, messages: -1 };
    _token = null;
  }
});

/* Polling périodique — s'active même app en arrière-plan */
self.addEventListener('periodicsync', e => {
  if (e.tag === 'arkina-poll') e.waitUntil(checkNow());
});

/* Fallback : polling via fetch event si periodicsync non supporté */
self.addEventListener('fetch', e => {
  /* On ne intercepte pas les vraies requêtes */
  if (!e.request.url.includes('__poll__')) return;
  e.respondWith(checkNow().then(() => new Response('ok')));
});

async function sbCount(table, filters = '') {
  if (!_token) return -1;
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/${table}?select=id${filters}&limit=1`,
      {
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zc2tlcmNtYm1nbWRmdGNwYXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NTE4NDMsImV4cCI6MjEwNjUyNzg0M30.Y2imKy5q0JFAJsM70doTtvys5KQR3T26CLgoiLnl5VA',
          'Authorization': `Bearer ${_token}`,
          'Prefer': 'count=exact',
          'Range': '0-0'
        }
      }
    );
    const range = res.headers.get('Content-Range') || '';
    const m = range.match(/\/(\d+)$/);
    return m ? parseInt(m[1]) : 0;
  } catch { return -1; }
}

async function checkNow() {
  if (!_token) return;
  const [cO, cR, cM] = await Promise.all([
    sbCount('orders', '&status=eq.en attente'),
    sbCount('reviews', '&approved=eq.false'),
    sbCount('messages', '&from_admin=eq.false&read=eq.false')
  ]);

  if (_prev.orders >= 0 && cO > _prev.orders) notify('🛒 Nouvelle commande', `${cO - _prev.orders} nouvelle(s) commande(s) en attente`, 'orders');
  if (_prev.reviews >= 0 && cR > _prev.reviews) notify('⭐ Nouvel avis', `${cR - _prev.reviews} avis à valider`, 'reviews');
  if (_prev.messages >= 0 && cM > _prev.messages) notify('💬 Nouveau message', `${cM - _prev.messages} message(s) de client(s)`, 'messages');

  if (cO >= 0) _prev.orders = cO;
  if (cR >= 0) _prev.reviews = cR;
  if (cM >= 0) _prev.messages = cM;

  /* Notifie la page ouverte pour qu'elle rafraîchisse */
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'REFRESH' }));
}

function notify(title, body, tag) {
  if (self.registration.showNotification) {
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag,
      requireInteraction: true,
      data: { url: '/admin-app.html' }
    });
  }
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if (c.url.includes('admin-app')) { c.focus(); return; } }
      return clients.openWindow('/admin-app.html');
    })
  );
});
