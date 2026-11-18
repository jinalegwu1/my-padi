const fs = require('node:fs');
const path = require('node:path');

// Register the built-in node:test cases in one process. This also supports
// Node versions whose isolated runner does not track manually compiled TS modules.
for (const filename of fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs')).sort()) {
  require(path.join(__dirname, filename));
}
