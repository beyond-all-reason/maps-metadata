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
- `/i/{imagorUrl}` fetches image from the imagor instance, trying to resolve in order
  from cache, R2 results bucket, and then in the end query imagor instance itself.

Note that because `/latest/*` is dynamic, it might return results from multiple
different versions when multiple requests are being made, so if consistency is
important the `/{commit}/*` version needs to be used.

Caching
-------

HEAD is being cached for 10 minutes, so that's how long it might take for the new
push to appear in `/latest/`. Files returned from `/latest/` by default have
cache timeout specified to 30 minutes. `/{commit}/` and `/i/{imagorUrl}` are
considered immutable and browser can cache it forever.

Headers
-------

There are a few custom headers returned for requests. For the maps metadata ones:

- `x-maps-metadata-commit`: for `/HEAD` and `/latest/*` returns the commit that
  HEAD resolved to when doing lookup.
- `x-maps-metadata-cache`: Whatever requested file was loaded from cache or R2.
- `x-maps-metadata-head-cache`: Whatever HEAD resolution was done using cache or
  had to fallback to R2.

For imagor url:

- `x-maps-metadata-imagor-cache`: with possible values of `hit`, `r2-hit`, `miss`.
