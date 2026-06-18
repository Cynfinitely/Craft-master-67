/**
 * No-op shim for `server-only` when running CLI scripts via tsx/node.
 * Next.js uses that package to block client imports; standalone workers are server-side.
 */
"use strict";

const Module = require("module");
const originalLoad = Module._load;

Module._load = function shimServerOnly(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
