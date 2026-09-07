/* Водомер — офлайн-кэш. Страница обязана открываться без сети. */
var CACHE = "vodomer-v4";
var ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ return k === CACHE ? null : caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;

  // Страница: сначала сеть, кэш — запасной путь.
  // cache:"no-cache" обязателен: GitHub Pages отдаёт страницу с max-age=600,
  // и обычный fetch десять минут возвращает старую копию из кэша браузера.
  if(req.mode === "navigate"){
    e.respondWith(
      fetch(req.url, { cache: "no-cache" }).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put("./index.html", copy); });
        return res;
      }).catch(function(){
        return caches.match("./index.html").then(function(r){ return r || caches.match("./"); });
      })
    );
    return;
  }

  // Остальное (иконки, шрифты): кэш сразу, обновление в фоне.
  e.respondWith(
    caches.match(req).then(function(hit){
      var net = fetch(req).then(function(res){
        if(res && (res.status === 200 || res.type === "opaque")){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){ return hit; });
      return hit || net;
    })
  );
});

/* --- Пуш-уведомления. Расписание живёт на сервере (GitHub Actions),
       потому что iOS не даёт странице будить себя по таймеру. --- */
self.addEventListener("push", function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch(err){ d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Водомер", {
    body: d.body || "Пора попить",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag || "vodomer",
    renotify: true,
    data: { url: d.url || (d.title === "Итог дня" ? "./#report" : "./") }
  }));
});

self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var target = new URL((e.notification.data && e.notification.data.url) || "./", self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      for(var i = 0; i < list.length; i++){
        if(list[i].url.indexOf(self.registration.scope) === 0 && "focus" in list[i]) return list[i].focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});
