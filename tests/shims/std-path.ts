import * as nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const basename = nodePath.basename;
export const dirname = nodePath.dirname;
export const extname = nodePath.extname;
export const isAbsolute = nodePath.isAbsolute;
export const join = nodePath.join;
export const normalize = nodePath.normalize;
export const relative = nodePath.relative;
export const resolve = nodePath.resolve;

export function fromFileUrl(url: string | URL): string {
  return fileURLToPath(url);
}

export function toFileUrl(path: string): URL {
  return pathToFileURL(path);
}
