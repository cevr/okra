---
"@cvr/okra": patch
---

Fix GitHub skill installs and updates to prefer real skill copies and include the contents of repository symlinks, including directory references. Reject dangling, escaping, and cyclic links before changing installed files, and repair existing lock entries pointing at symlinked copies.
