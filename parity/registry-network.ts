// TS-side transport for repo parity: registry hosts go to one loopback fake,
// loopback passes, everything else is refused. Redirects are followed by hand
// so a redirect can never leave loopback. Mirrors cmd/okra-parity's rewrites.
export {};
const origin = process.env.OKRA_PARITY_ORIGIN ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("parity origin must be loopback");
const rewrites: Array<[string, string]> = [
  ["https://registry.npmjs.org/", `${origin}/npm/`],
  ["https://pypi.org/", `${origin}/pypi/`],
  ["https://files.pythonhosted.org/", `${origin}/files/`],
  ["https://crates.io/", `${origin}/crates/`],
];
const route = (url: string) => {
  for (const [from, to] of rewrites) if (url.startsWith(from)) return to + url.slice(from.length);
  if (url.startsWith(`${origin}/`)) return url;
  throw new TypeError(`parity refuses ${url}`);
};
const real = globalThis.fetch;
const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  let url = route(request.url);
  for (let hop = 0; hop <= 20; hop++) {
    const response = await real(url, {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
      signal: request.signal,
    });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status > 399 || location === null) return response;
    url = route(new URL(location, url).toString());
  }
  throw new TypeError("parity redirect limit");
};
globalThis.fetch = Object.assign(wrapped, { preconnect: real.preconnect });
