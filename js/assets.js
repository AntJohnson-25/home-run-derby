// Asset access. Served: plain fetches from assets/. The single-file
// deliverable (tools/build-deliverable.mjs) sets globalThis.PB_EMBED to a map
// of the same paths -> parsed JSON or data: URLs, so nothing is fetched.
const BASE = new URL("../assets/", import.meta.url);
const EMBED = () => globalThis.PB_EMBED || null;

export function assetJSON(path) {
  const E = EMBED();
  if (E) {
    if (!(path in E)) return Promise.reject(new Error("not embedded: " + path));
    return Promise.resolve(E[path]);
  }
  return fetch(new URL(path, BASE)).then((r) => {
    if (!r.ok) throw new Error(path + ": " + r.status);
    return r.json();
  });
}

export function assetURL(path) {
  const E = EMBED();
  if (E && path in E) return E[path];
  return new URL(path, BASE).href;
}
