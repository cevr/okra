---
"@cvr/okra": patch
---

`okra image` (OpenAI backends) now surfaces the API's real error message.

A non-2xx response from `/images/generations` or `/images/edits` previously collapsed to an opaque `non 2xx status code (400 ...)`. The OpenAI error body (`{ "error": { "message": "..." } }`) is now read and included, so failures like `Billing hard limit has been reached.` or a rejected prompt reach the user directly (with the HTTP status). 401/403 still map to `AUTH_EXPIRED` but now carry the API's reason too.
