const CACHE_NAME = "ledger-notes-v2";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./manifest.json"
];

self.addEventListener("install", function(event) {

    event.waitUntil(

        caches.open(CACHE_NAME)
            .then(function(cache) {

                return cache.addAll(
                    FILES_TO_CACHE
                );

            })

    );

});


self.addEventListener("activate", function(event) {

    event.waitUntil(

        caches.keys()
            .then(function(names) {

                return Promise.all(

                    names
                        .filter(function(name) {

                            return name !== CACHE_NAME;

                        })
                        .map(function(name) {

                            return caches.delete(name);

                        })

                );

            })

    );

});


self.addEventListener("fetch", function(event) {

    event.respondWith(

        caches.match(event.request)
            .then(function(response) {

                return response ||
                       fetch(event.request);

            })

    );

});
