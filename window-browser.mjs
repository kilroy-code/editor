// In browser, we are given a window object.
// To use the version (as opposed to window-node.mjs), either:
// a) build, pack, or otherwise rollup the source with something that respects the package.json import map.
// b) define an importmap
export const Window = window;
