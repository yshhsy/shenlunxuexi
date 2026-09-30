// 申论学习离线缓存：安装只缓存小壳（秒装）；题库/app.js 随页面加载经 fetch handler 运行时缓存，
// 页面就绪后再后台补缓存漏网文件——首访零双重下载
var CACHE = "shenlun-app-v1.0.0";
var ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./splash-750x1334.png", "./splash-1125x2436.png", "./splash-1170x2532.png", "./splash-1179x2556.png", "./splash-1284x2778.png", "./splash-1290x2796.png", "./splash-2048x2732.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // 逐个缓存、单个失败不阻塞（弱网下装一半也保住已下载的，下次继续补）
    return Promise.all(ASSETS.map(function (u) {
      return c.add(new Request(u, { cache: "reload" })).catch(function (err) {
        console.warn("[sw] 缓存失败，稍后重试:", u, err && err.message);
      });
    }));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "GET_VERSION" && e.source) {
    e.source.postMessage({ type: "VERSION", version: CACHE });
  }
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  // 页面导航请求：限时 network-first——4 秒内网络没响应就先用缓存版（秒开，后台继续刷新）；
  // 完全离线/无缓存才白等。修复弱网下 10MB 主文档下载挂起导致白屏「进不去」。
  // 其余静态资源保持 cache-first（单文件版主资源只有 index.html）
  if (e.request.mode === "navigate") {
    e.respondWith(
      Promise.race([
        fetch(e.request).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          return res;
        }).catch(function () { throw new Error("offline"); }),
        new Promise(function (resolve, reject) {
          setTimeout(function () { reject(new Error("timeout")); }, 4000);
        })
      ]).catch(function () {
        return caches.match(e.request).then(function (hit) {
          if (hit) return hit;
          return caches.match("./index.html").then(function (h2) {
            if (h2) return h2;
            // 无缓存（首次访问）：只能等网络，不再限时
            return fetch(e.request).catch(function () { throw new Error("offline-and-no-cache"); });
          });
        });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return Response.error(); });
    })
  );
});
