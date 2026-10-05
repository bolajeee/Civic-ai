const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

// TypeScript emits CommonJS. Scope that format to the build output while
// preserving ESM for tsx development and tests that use top-level await.
writeFileSync(resolve(__dirname, '../dist/package.json'), '{"type":"commonjs"}\n');
