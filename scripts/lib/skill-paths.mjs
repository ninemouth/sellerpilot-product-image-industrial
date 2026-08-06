import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Convert an ESM module URL to the skill root without treating a file URL
 * pathname as a native filesystem path. The latter is invalid on Windows.
 */
export function skillRootFrom(moduleUrl) {
  return path.resolve(fileURLToPath(new URL("..", moduleUrl)));
}
