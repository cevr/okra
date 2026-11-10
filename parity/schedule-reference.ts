// The offline schedule reference: a frozen clock (parity/clock.ts) and a
// network that refuses every request, installed before the CLI loads
// (modules evaluate in this order). No live service is reachable.
export * as clock from "./clock";
export * as network from "./deny-network";
export * as cli from "../src/main";
