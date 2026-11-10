// Build this entry, not the shipped binary: the deny-by-default transport is
// installed before the CLI loads (modules evaluate in this order). No live
// reference call is permitted.
export * as network from "./image-network";
export * as cli from "../src/main";
