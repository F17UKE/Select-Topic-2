// Execute the actual client cart store; only React hooks and browser storage are hosted here.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { transformSync } = require('next/dist/build/swc');
function createCartSmoke() {
  const filename = path.join(__dirname, '../frontend/lib/cart.js');
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), { filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' },
    module: { type: 'commonjs' } });
  const module = { exports: {} };
  const storage = new Map();
  vm.runInNewContext(code, { module, exports: module.exports, crypto: require('node:crypto').webcrypto,
    window: { localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } },
    require: (id) => id === 'react' ? { ...React, useSyncExternalStore: (_, snapshot) => snapshot(), useMemo: (factory) => factory() } : require(id) });
  return () => module.exports.CartProvider({ children: null }).props.value;
}
module.exports = { createCartSmoke };
