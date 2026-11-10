// Keys/how are offline. Any accidental live HTTP use is a harness failure.
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply() {
    throw new Error("O1 refuses every network request");
  },
});
