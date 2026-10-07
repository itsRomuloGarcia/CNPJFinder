const CACHE_NAME = 'cnpj-finder-v1.2.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/logo.svg'
];

self.addEventListener('install', (event) => {
  console.log('🔄 Service Worker instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Cache aberto:', CACHE_NAME);
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ Todos os recursos cacheados');
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('🎯 Service Worker ativando...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker ativado');
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // API: sempre direto na rede, nunca cacheada (dados precisam estar atualizados)
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  if (sameOrigin) {
    // Arquivos do site: Network First, para que todo deploy chegue aos usuários.
    // O cache só é usado quando o usuário está offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached || (request.mode === 'navigate' ? caches.match('/') : undefined)
          )
        )
    );
    return;
  }

  // Recursos externos versionados (fontes, SheetJS): Cache First
  event.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(request)
          .then((response) => {
            // Não cacheamos respostas que não sejam bem-sucedidas
            if (!response || response.status !== 200) {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseToCache));
            return response;
          });
      })
  );
});

// Ouvinte para mensagens da página principal
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
