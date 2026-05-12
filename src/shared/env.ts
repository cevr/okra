// eslint-disable-next-line node/no-process-env -- module-load TTY/NO_COLOR detection
export const isColorEnabled = !("NO_COLOR" in process.env) && process.stdout.isTTY;
