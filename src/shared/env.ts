export const isColorEnabled = !("NO_COLOR" in process.env) && !!process.stdout.isTTY;
