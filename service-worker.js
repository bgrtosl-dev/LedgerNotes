const CACHE_NAME = "ledger-notes-v3";

const APP_FILES = [ "./", "./index.html", "./manifest.json" ];

/* ============================================================ INSTALL

Download the current version of the app. ============================================================ */

self.addEventListener("install", function(event) {

event.waitUntil(

caches.open(CACHE_NAME) .then(function(cache) {

return cache.addAll(APP_FILES);

}) .then(function() {

return self.skipWaiting();

})

);

});

/* ============================================================ ACTIVATE

Delete older caches automatically. ============================================================ */

self.addEventListener("activate", function(event) {

event.waitUntil(

caches.keys() .then(function(cacheNames) {

return Promise.all(

cacheNames .filter(function(name) {

return name !== CACHE_NAME;

}) .map(function(name) {

return caches.delete(name);

})

);

}) .then(function() {

return self.clients.claim();

})

);

});

/* ============================================================ FETCH

For HTML files, try the Internet first.

This means that when we publish a new version, the browser gets the new index.html rather than being stuck with the old cached version.

If there is no Internet connection, the cached version is used instead. ============================================================ */

self.addEventListener("fetch", function(event) {

/* Only handle GET requests. */

if (event.request.method !== "GET") { return; }

/* For navigation / HTML: network first, cache as fallback. */

if ( event.request.mode === "navigate" || event.request.destination === "document" ) {

event.respondWith(

fetch(event.request) .then(function(response) {

/* Save the new HTML in the cache. */

const responseClone = response.clone();

caches.open(CACHE_NAME) .then(function(cache) {

cache.put( event.request, responseClone );

});

return response;

}) .catch(function() {

return caches.match( event.request );

})

);

return; }

/* For other files: cache first, then network. */

event.respondWith(

caches.match(event.request) .then(function(response) {

return response || fetch(event.request);

})

);

});
