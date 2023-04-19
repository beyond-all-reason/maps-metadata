serving
=======

A CloudFlare Worker script running on https://maps-metadata.beyondallreason.dev/
and serving contents of the maps metadata from R2 bucket with caching.

Service
-------

- `/HEAD` returns the latest commit that was pushed to the serving as `text/plain`.
- `/{commit}/{filePath}` fetches the `{filePath}` from generated files at
  `{commit}`.
- `/latest/{filePath}` fetches the `{filePath}` from the latest generated files.
  Internally it dynamically resolves HEAD and translates to the commit version.

Note that because `/latest/*` is dynamic, it might return results from multiple
different versions when multiple requests are being made, so if consistency is
important the `/{commit}/*` version needs to be used.

Caching
-------

HEAD is being cached for 10 minutes, so that's how long it might take for the new
push to appear in `/latest/`. Files returned from `/latest/` by default have
cache timeout specified to 30 minutes. `/{commit}/` are considered immutable
and browser can cache it forever.

Headers
-------

There are a few custom headers returned for requests:

- `x-maps-metadata-commit`: for `/HEAD` and `/latest/*` returns the commit that
  HEAD resolved to when doing lookup.
- `x-maps-metadata-cache`: Whatever requested file was loaded from cache or R2.
- `x-maps-metadata-head-cache`: Whatever HEAD resolution was done using cache or
  had to fallback to R2.
