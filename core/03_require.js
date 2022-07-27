// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
"use strict";

((window) => {
  class Module {
    constructor(id = "", parent) {
      this.id = id;
      this.exports = {};
      this.parent = parent || null;
      // TODO:
      //   updateChildren(parent || null, this, false);

      this.filename = null;
      this.loaded = false;
      this.children = [];
      this.paths = [];
      this.path = path.dirname(id);
    }

    static builtinModules = [];
    static _extensions = Object.create(null);
    static _cache = Object.create(null);
    static _pathCache = Object.create(null);
    static globalPaths = [];
    static wrapper = [
      // We provide non standard timer APIs in the CommonJS wrapper
      // to avoid exposing them in global namespace.
      "(function (exports, require, module, __filename, __dirname, setTimeout, clearTimeout, setInterval, clearInterval) { (function (exports, require, module, __filename, __dirname) {",
      "\n}).call(this, exports, require, module, __filename, __dirname); })",
    ];

    // Loads a module at the given file path. Returns that module's
    // `exports` property.
    require(id) {
      //   if (id === "") {
      //     throw new Error(`id '${id}' must be a non-empty string`);
      //   }
      //   requireDepth++;
      //   try {
      //     return Module._load(id, this, /* isMain */ false);
      //   } finally {
      //     requireDepth--;
      //   }
    }

    // Given a file name, pass it to the proper extension handler.
    load(filename) {
      //   assert(!this.loaded);
      //   this.filename = filename;
      //   this.paths = Module._nodeModulePaths(path.dirname(filename));

      //   const extension = findLongestRegisteredExtension(filename);
      //   // Removed ESM code
      //   Module._extensions[extension](this, filename);
      //   this.loaded = true;
      // Removed ESM code
    }

    // Run the file contents in the correct scope or sandbox. Expose
    // the correct helper variables (require, module, exports) to
    // the file.
    // Returns exception, if any.
    _compile(content, filename) {
      //   // manifest code removed
      //   const compiledWrapper = wrapSafe(filename, content, this);
      //   // inspector code remove
      //   const dirname = path.dirname(filename);
      //   const require = makeRequireFunction(this);
      //   const exports = this.exports;
      //   const thisValue = exports;
      //   if (requireDepth === 0) {
      //     statCache = new Map();
      //   }
      //   const result = compiledWrapper.call(
      //     thisValue,
      //     exports,
      //     require,
      //     this,
      //     filename,
      //     dirname,
      //     setTimeout,
      //     clearTimeout,
      //     setInterval,
      //     clearInterval,
      //   );
      //   if (requireDepth === 0) {
      //     statCache = null;
      //   }
      //   return result;
    }

    // Check for node modules paths.
    static _resolveLookupPaths(
      request,
      parent,
    ) {
      //   if (
      //     request.charAt(0) !== "." ||
      //     (request.length > 1 &&
      //       request.charAt(1) !== "." &&
      //       request.charAt(1) !== "/" &&
      //       (!isWindows || request.charAt(1) !== "\\"))
      //   ) {
      //     let paths = modulePaths;
      //     if (parent !== null && parent.paths && parent.paths.length) {
      //       paths = parent.paths.concat(paths);
      //     }

      //     return paths.length > 0 ? paths : null;
      //   }

      //   // With --eval, parent.id is not set and parent.filename is null.
      //   if (!parent || !parent.id || !parent.filename) {
      //     // Make require('./path/to/foo') work - normally the path is taken
      //     // from realpath(__filename) but with eval there is no filename
      //     return ["."].concat(Module._nodeModulePaths("."), modulePaths);
      //   }
      //   // Returns the parent path of the file
      //   return [path.dirname(parent.filename)];
    }

    static _resolveFilename(
      request,
      parent,
      isMain,
      options,
    ) {
      // // Polyfills.
      // if (
      //   request.startsWith("node:") ||
      //   nativeModuleCanBeRequiredByUsers(request)
      // ) {
      //   return request;
      // }

      // let paths: string[];

      // if (typeof options === "object" && options !== null) {
      //   if (Array.isArray(options.paths)) {
      //     const isRelative = request.startsWith("./") ||
      //       request.startsWith("../") ||
      //       (isWindows && request.startsWith(".\\")) ||
      //       request.startsWith("..\\");

      //     if (isRelative) {
      //       paths = options.paths;
      //     } else {
      //       const fakeParent = new Module("", null);

      //       paths = [];

      //       for (let i = 0; i < options.paths.length; i++) {
      //         const path = options.paths[i];
      //         fakeParent.paths = Module._nodeModulePaths(path);
      //         const lookupPaths = Module._resolveLookupPaths(request, fakeParent);

      //         for (let j = 0; j < lookupPaths!.length; j++) {
      //           if (!paths.includes(lookupPaths![j])) {
      //             paths.push(lookupPaths![j]);
      //           }
      //         }
      //       }
      //     }
      //   } else if (options.paths === undefined) {
      //     paths = Module._resolveLookupPaths(request, parent)!;
      //   } else {
      //     throw new Error("options.paths is invalid");
      //   }
      // } else {
      //   paths = Module._resolveLookupPaths(request, parent)!;
      // }

      // if (parent?.filename) {
      //   if (request[0] === "#") {
      //     const pkg = readPackageScope(parent.filename) ||
      //       { path: "", data: {} as PackageInfo };
      //     if (pkg.data?.imports != null) {
      //       try {
      //         return finalizeEsmResolution(
      //           packageImportsResolve(
      //             request,
      //             pathToFileURL(parent.filename).toString(),
      //             cjsConditions,
      //           ).toString(),
      //           parent.filename,
      //           pkg.path,
      //         );
      //       } catch (e) {
      //         if (e instanceof NodeError && e.code === "ERR_MODULE_NOT_FOUND") {
      //           throw createEsmNotFoundErr(request);
      //         }
      //         throw e;
      //       }
      //     }
      //   }
      // }

      // // Try module self resolution first
      // const parentPath = trySelfParentPath(parent);
      // const selfResolved = trySelf(parentPath, request);
      // if (selfResolved) {
      //   const cacheKey = request + "\x00" +
      //     (paths.length === 1 ? paths[0] : paths.join("\x00"));
      //   Module._pathCache[cacheKey] = selfResolved;
      //   return selfResolved;
      // }

      // // Look up the filename first, since that's the cache key.
      // const filename = Module._findPath(request, paths, isMain);
      // if (!filename) {
      //   const requireStack = [];
      //   for (let cursor: Module | null = parent; cursor; cursor = cursor.parent) {
      //     requireStack.push(cursor.filename || cursor.id);
      //   }
      //   let message = `Cannot find module '${request}'`;
      //   if (requireStack.length > 0) {
      //     message = message + "\nRequire stack:\n- " + requireStack.join("\n- ");
      //   }
      //   const err = new Error(message) as Error & {
      //     code: string;
      //     requireStack: string[];
      //   };
      //   err.code = "MODULE_NOT_FOUND";
      //   err.requireStack = requireStack;
      //   throw err;
      // }
      // return filename as string;
    }

    static _findPath(
      request,
      paths,
      isMain,
    ) {
      // const absoluteRequest = path.isAbsolute(request);
      // if (absoluteRequest) {
      //   paths = [""];
      // } else if (!paths || paths.length === 0) {
      //   return false;
      // }

      // const cacheKey = request + "\x00" +
      //   (paths.length === 1 ? paths[0] : paths.join("\x00"));
      // const entry = Module._pathCache[cacheKey];
      // if (entry) {
      //   return entry;
      // }

      // let exts;
      // let trailingSlash = request.length > 0 &&
      //   request.charCodeAt(request.length - 1) === CHAR_FORWARD_SLASH;
      // if (!trailingSlash) {
      //   trailingSlash = /(?:^|\/)\.?\.$/.test(request);
      // }

      // // For each path
      // for (let i = 0; i < paths.length; i++) {
      //   // Don't search further if path doesn't exist
      //   const curPath = paths[i];

      //   if (curPath && stat(curPath) < 1) continue;
      //   const basePath = resolveExports(curPath, request, absoluteRequest);
      //   let filename;

      //   const rc = stat(basePath);
      //   if (!trailingSlash) {
      //     if (rc === 0) {
      //       // File.
      //       // preserveSymlinks removed
      //       filename = toRealPath(basePath);
      //     }

      //     if (!filename) {
      //       // Try it with each of the extensions
      //       if (exts === undefined) exts = Object.keys(Module._extensions);
      //       filename = tryExtensions(basePath, exts, isMain);
      //     }
      //   }

      //   if (!filename && rc === 1) {
      //     // Directory.
      //     // try it with each of the extensions at "index"
      //     if (exts === undefined) exts = Object.keys(Module._extensions);
      //     filename = tryPackage(basePath, exts, isMain, request);
      //   }

      //   if (filename) {
      //     Module._pathCache[cacheKey] = filename;
      //     return filename;
      //   }
      // }
      // // trySelf removed.

      // return false;
    }

    // Check the cache for the requested file.
    // 1. If a module already exists in the cache: return its exports object.
    // 2. If the module is native: call
    //    `NativeModule.prototype.compileForPublicLoader()` and return the exports.
    // 3. Otherwise, create a new module for the file and save it to the cache.
    //    Then have it load  the file contents before returning its exports
    //    object.
    // deno-lint-ignore no-explicit-any
    static _load(request, parent, isMain) {
      // let relResolveCacheIdentifier: string | undefined;
      // if (parent) {
      //   // Fast path for (lazy loaded) modules in the same directory. The indirect
      //   // caching is required to allow cache invalidation without changing the old
      //   // cache key names.
      //   relResolveCacheIdentifier = `${parent.path}\x00${request}`;
      //   const filename = relativeResolveCache[relResolveCacheIdentifier];
      //   if (filename !== undefined) {
      //     const cachedModule = Module._cache[filename];
      //     if (cachedModule !== undefined) {
      //       updateChildren(parent, cachedModule, true);
      //       if (!cachedModule.loaded) {
      //         return getExportsForCircularRequire(cachedModule);
      //       }
      //       return cachedModule.exports;
      //     }
      //     delete relativeResolveCache[relResolveCacheIdentifier];
      //   }
      // }

      // // NOTE(@bartlomieju): this is a temporary solution. We provide some
      // // npm modules with fixes in inconsistencies between Deno and Node.js.
      // const upstreamMod = loadUpstreamModule(request, parent, request);
      // if (upstreamMod) return upstreamMod.exports;

      // const filename = Module._resolveFilename(request, parent, isMain);
      // if (filename.startsWith("node:")) {
      //   // Slice 'node:' prefix
      //   const id = filename.slice(5);
      //   const module = loadNativeModule(id, id);
      //   // NOTE: Skip checking if can be required by user,
      //   // because we don't support internal modules anyway.
      //   return module?.exports;
      // }

      // const cachedModule = Module._cache[filename];
      // if (cachedModule !== undefined) {
      //   updateChildren(parent, cachedModule, true);
      //   if (!cachedModule.loaded) {
      //     return getExportsForCircularRequire(cachedModule);
      //   }
      //   return cachedModule.exports;
      // }

      // // Native module polyfills
      // const mod = loadNativeModule(filename, request);
      // if (mod) return mod.exports;

      // // Don't call updateChildren(), Module constructor already does.
      // const module = new Module(filename, parent);

      // if (isMain) {
      //   process.mainModule = module;
      //   module.id = ".";
      // }

      // Module._cache[filename] = module;
      // if (parent !== undefined) {
      //   relativeResolveCache[relResolveCacheIdentifier!] = filename;
      // }

      // let threw = true;
      // try {
      //   // Source map code removed
      //   module.load(filename);
      //   threw = false;
      // } finally {
      //   if (threw) {
      //     delete Module._cache[filename];
      //     if (parent !== undefined) {
      //       delete relativeResolveCache[relResolveCacheIdentifier!];
      //     }
      //   } else if (
      //     module.exports &&
      //     Object.getPrototypeOf(module.exports) ===
      //       CircularRequirePrototypeWarningProxy
      //   ) {
      //     Object.setPrototypeOf(module.exports, PublicObjectPrototype);
      //   }
      // }

      // return module.exports;
    }

    static wrap(script) {
      script = script.replace(/^#!.*?\n/, "");
      return `${Module.wrapper[0]}${script}${Module.wrapper[1]}`;
    }

    static _nodeModulePaths(from) {
      // if (isWindows) {
      //   // Guarantee that 'from' is absolute.
      //   from = path.resolve(from);

      //   // note: this approach *only* works when the path is guaranteed
      //   // to be absolute.  Doing a fully-edge-case-correct path.split
      //   // that works on both Windows and Posix is non-trivial.

      //   // return root node_modules when path is 'D:\\'.
      //   // path.resolve will make sure from.length >=3 in Windows.
      //   if (
      //     from.charCodeAt(from.length - 1) === CHAR_BACKWARD_SLASH &&
      //     from.charCodeAt(from.length - 2) === CHAR_COLON
      //   ) {
      //     return [from + "node_modules"];
      //   }

      //   const paths = [];
      //   for (let i = from.length - 1, p = 0, last = from.length; i >= 0; --i) {
      //     const code = from.charCodeAt(i);
      //     // The path segment separator check ('\' and '/') was used to get
      //     // node_modules path for every path segment.
      //     // Use colon as an extra condition since we can get node_modules
      //     // path for drive root like 'C:\node_modules' and don't need to
      //     // parse drive name.
      //     if (
      //       code === CHAR_BACKWARD_SLASH ||
      //       code === CHAR_FORWARD_SLASH ||
      //       code === CHAR_COLON
      //     ) {
      //       if (p !== nmLen) paths.push(from.slice(0, last) + "\\node_modules");
      //       last = i;
      //       p = 0;
      //     } else if (p !== -1) {
      //       if (nmChars[p] === code) {
      //         ++p;
      //       } else {
      //         p = -1;
      //       }
      //     }
      //   }

      //   return paths;
      // } else {
      //   // posix
      //   // Guarantee that 'from' is absolute.
      //   from = path.resolve(from);
      //   // Return early not only to avoid unnecessary work, but to *avoid* returning
      //   // an array of two items for a root: [ '//node_modules', '/node_modules' ]
      //   if (from === "/") return ["/node_modules"];

      //   // note: this approach *only* works when the path is guaranteed
      //   // to be absolute.  Doing a fully-edge-case-correct path.split
      //   // that works on both Windows and Posix is non-trivial.
      //   const paths = [];
      //   for (let i = from.length - 1, p = 0, last = from.length; i >= 0; --i) {
      //     const code = from.charCodeAt(i);
      //     if (code === CHAR_FORWARD_SLASH) {
      //       if (p !== nmLen) paths.push(from.slice(0, last) + "/node_modules");
      //       last = i;
      //       p = 0;
      //     } else if (p !== -1) {
      //       if (nmChars[p] === code) {
      //         ++p;
      //       } else {
      //         p = -1;
      //       }
      //     }
      //   }

      //   // Append /node_modules to handle root paths.
      //   paths.push("/node_modules");

      //   return paths;
      // }
    }

    /**
     * Create a `require` function that can be used to import CJS modules.
     * Follows CommonJS resolution similar to that of Node.js,
     * with `node_modules` lookup and `index.js` lookup support.
     * Also injects available Node.js builtin module polyfills.
     *
     * ```ts
     *     import { createRequire } from "./module.ts";
     *     const require = createRequire(import.meta.url);
     *     const fs = require("fs");
     *     const leftPad = require("left-pad");
     *     const cjsModule = require("./cjs_mod");
     * ```
     *
     * @param filename path or URL to current module
     * @return Require function to import CJS modules
     */
    static createRequire(filename) {
      // let filepath: string;
      // if (
      //   filename instanceof URL ||
      //   (typeof filename === "string" && !path.isAbsolute(filename))
      // ) {
      //   try {
      //     filepath = fileURLToPath(filename);
      //   } catch (err) {
      //     // deno-lint-ignore no-explicit-any
      //     if ((err as any).code === "ERR_INVALID_URL_SCHEME") {
      //       // Provide a descriptive error when url scheme is invalid.
      //       throw new Error(
      //         `${createRequire.name} only supports 'file://' URLs for the 'filename' parameter. Received '${filename}'`,
      //       );
      //     } else {
      //       throw err;
      //     }
      //   }
      // } else if (typeof filename !== "string") {
      //   throw new Error("filename should be a string");
      // } else {
      //   filepath = filename;
      // }
      // return createRequireFromPath(filepath);
    }

    static _initPaths() {
      // const homeDir = Deno.env.get("HOME");
      // const nodePath = Deno.env.get("NODE_PATH");

      // // Removed $PREFIX/bin/node case

      // let paths = [];

      // if (homeDir) {
      //   paths.unshift(path.resolve(homeDir, ".node_libraries"));
      //   paths.unshift(path.resolve(homeDir, ".node_modules"));
      // }

      // if (nodePath) {
      //   paths = nodePath
      //     .split(path.delimiter)
      //     .filter(function pathsFilterCB(path) {
      //       return !!path;
      //     })
      //     .concat(paths);
      // }

      // modulePaths = paths;

      // // Clone as a shallow copy, for introspection.
      // Module.globalPaths = modulePaths.slice(0);
    }

    static _preloadModules(requests) {
      // if (!Array.isArray(requests)) {
      //   return;
      // }

      // // Preloaded modules have a dummy parent module which is deemed to exist
      // // in the current working directory. This seeds the search path for
      // // preloaded modules.
      // const parent = new Module("internal/preload", null);
      // try {
      //   parent.paths = Module._nodeModulePaths(Deno.cwd());
      // } catch (e) {
      //   if (
      //     !(e instanceof Error) ||
      //     (e as Error & { code?: string }).code !== "ENOENT"
      //   ) {
      //     throw e;
      //   }
      // }
      // for (let n = 0; n < requests.length; n++) {
      //   parent.require(requests[n]);
      // }
    }
  }

  window.__bootstrap.require = {
    Module,
  };
})(globalThis);
