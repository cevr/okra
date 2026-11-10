// Compiled only into the offline schedule reference. OKRA_PARITY_NOW (Unix
// milliseconds) freezes Date.now, which Effect's Clock and DateTime.now read,
// so the reference and the port see one instant. Unset, nothing changes.
export {};
const frozen = process.env.OKRA_PARITY_NOW;
if (frozen !== undefined) {
  const now = Number(frozen);
  if (!Number.isSafeInteger(now)) throw new Error("OKRA_PARITY_NOW must be integer milliseconds");
  Date.now = () => now;
}
