// 迷你 AMD 加载器：只有 import/export 的等价物，不含任何打包或动态加载。
// tsc 以 module=AMD + outFile 产出的 core.js 会调用 define(name, deps, factory)，
// 本文件负责把它们登记下来，并在 require([...]) 时按依赖顺序执行。
(function (global) {
  var defs = {};   // 名字 -> { deps, factory }
  var instances = {}; // 名字 -> { exports }

  function resolve(name) {
    if (Object.prototype.hasOwnProperty.call(instances, name)) return instances[name].exports;
    var d = defs[name];
    if (!d) throw new Error('AMD：找不到模块 ' + name);
    var mod = { exports: {} };
    instances[name] = mod; // 先占位，环状依赖时对应 CommonJS 的“部分导出”行为
    var req = function (dep) { return resolve(dep); };
    // tsc 的 outFile AMD 写法把依赖模块当作工厂函数的位置参数：
    // define("game", ["require","exports","turn"], function (require, exports, turn_2) {...})
    var args = d.deps.map(function (dep) {
      if (dep === 'require') return req;
      if (dep === 'exports') return mod.exports;
      if (dep === 'module') return mod;
      return resolve(dep);
    });
    d.factory.apply(null, args);
    return mod.exports;
  }

  global.define = function (name, deps, factory) {
    if (typeof deps === 'function') { factory = deps; deps = []; }
    defs[name] = { deps: deps, factory: factory };
  };
  global.define.amd = true;

  global.require = function (deps, cb) {
    var out = deps.map(resolve);
    if (cb) cb.apply(null, out);
    return out.length === 1 ? out[0] : out;
  };
})(this);
