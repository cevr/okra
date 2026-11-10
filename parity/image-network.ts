// Compiled only into the offline reference binary. No owner HOME, key or
// network origin is inherited. Every request is mapped to one loopback peer.
export {};
const real = globalThis.fetch;
const rewrites = [
  ["https://chatgpt.com/backend-api/codex/", "/codex/"],
  ["https://api.openai.com/v1/", "/openai/"],
  ["https://models.dev/", "/catalog/"],
] as const;
const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
  const origin = process.env.OKRA_PARITY_ORIGIN ?? "";
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d*$/.test(origin))
    throw new Error("image parity requires a loopback origin");
  const request = new Request(input, init);
  const rewrite = rewrites.find(([from]) => request.url.startsWith(from));
  if (!rewrite) throw new TypeError("image parity refuses external origin");
  return real(origin + rewrite[1] + request.url.slice(rewrite[0].length), {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" ? undefined : await request.arrayBuffer(),
    redirect: "manual",
    signal: request.signal,
  });
};
globalThis.fetch = Object.assign(wrapped, { preconnect: real.preconnect });
