// The how domain is pure — its docs are embedded at compile time, so there is
// no service layer to provide.
export { howRoot as howCommand } from "./commands/index.js";
export { isHowError } from "./errors.js";
