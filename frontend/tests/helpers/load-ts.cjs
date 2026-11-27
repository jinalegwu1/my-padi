const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function load(relative, mocks = {}, compile = source => source) {
  const filename = path.resolve(__dirname, '../..', relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : Module.prototype.require.call(loaded, name);
  loaded._compile(compile(fs.readFileSync(filename, 'utf8'), filename), filename);
  return loaded.exports;
}

exports.loadJS = load;
exports.loadTS = (relative, mocks) => load(relative, mocks, (source, filename) => {
  const ts = require('typescript');
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
});
