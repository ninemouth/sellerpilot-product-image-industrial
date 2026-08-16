import path from "node:path";

/**
 * Encode a run-relative artifact location for JSON contracts. Contract paths
 * always use POSIX separators, regardless of the host filesystem.
 */
export function relativeContractPath(from, to, pathApi = path) {
  return pathApi.relative(from, to).split(pathApi.sep).join("/");
}
