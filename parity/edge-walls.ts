// Run by parity/until.ts with TZ set: the local wall clocks (fields counted
// as UTC milliseconds) at the edges of the range a Date holds, as Bun reads
// them under this TZ: the lowest wall a local Date accepts near
// -271821-04-20 and the highest near +275760-09-13. Bun is the oracle here;
// the port's equivalent-year rule is not modelled.
const max = 8.64e15;
const day = 86400000;
function civil(ms: number) {
  const days = Math.floor(ms / day);
  const rest = ms - days * day;
  const z = days + 719468; // civil_from_days (H. Hinnant)
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const mo = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (mo <= 2 ? 1 : 0), mo, d: doy - Math.floor((153 * mp + 2) / 5) + 1, rest };
}
// A local Date of this wall clock: NaN outside the range.
function reads(wall: number) {
  const c = civil(wall);
  const t = new Date(c.y, c.mo - 1, c.d, Math.floor(c.rest / 3600000), Math.floor(c.rest / 60000) % 60, Math.floor(c.rest / 1000) % 60, c.rest % 1000);
  return !Number.isNaN(t.getTime());
}
// The boundary between a wall that reads and one that does not, within two
// days of the bound (zone offsets are under a day).
function edge(inside: number, outside: number) {
  if (!reads(inside) || reads(outside)) throw new Error(`no edge between ${inside} and ${outside}`);
  while (Math.abs(outside - inside) > 1) {
    const mid = inside + Math.trunc((outside - inside) / 2);
    if (reads(mid)) inside = mid;
    else outside = mid;
  }
  return inside;
}
console.log(JSON.stringify({ low: edge(-max + 2 * day, -max - 2 * day), high: edge(max - 2 * day, max + 2 * day) }));
