/**
 * Logs an info message with [INFO] prefix
 * @param message - The message to log
 */
export function info(message: string): void {
  console.log(`[INFO] ${message}`);
}

/**
 * Logs an error message with [ERROR] prefix
 * @param message - The message to log
 */
export function error(message: string): void {
  console.log(`[ERROR] ${message}`);
}

/**
 * Logs a warning message with [WARN] prefix
 * @param message - The message to log
 */
export function warn(message: string): void {
  console.log(`[WARN] ${message}`);
}
