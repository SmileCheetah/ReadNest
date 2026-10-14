#!/usr/bin/env node
// BullMQ 5.78.1 can emit a late init rejection after close() has removed its
// error listeners. That derived catch promise then becomes unhandled. Keep
// live connection errors unchanged and suppress only emissions after closure.
// Re-evaluate this compatibility patch before upgrading BullMQ.
const fs = require('node:fs');
const path = require('node:path');

const packagePath = require.resolve('bullmq/package.json');
const packageRoot = path.dirname(packagePath);
const version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
if (version !== '5.78.1') {
  throw new Error('Re-evaluate the Redis close compatibility patch for this BullMQ version.');
}

const original = "this.initializing.catch(err => this.emit('error', err));";
const patched = [
  'this.initializing.catch(err => {',
  "            if (this.status !== 'closed') this.emit('error', err);",
  '        });',
].join('\n');

// Validate both module formats before changing either installed file.
const updates = ['cjs', 'esm'].map((format) => {
  const file = path.join(packageRoot, 'dist', format, 'classes', 'redis-connection.js');
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(patched)) return null;
  if (source.split(original).length !== 2) {
    throw new Error(`Unexpected BullMQ ${format} source; review the Redis close compatibility patch.`);
  }
  return { file, content: source.replace(original, patched) };
});

for (const update of updates) {
  if (update) fs.writeFileSync(update.file, update.content, 'utf8');
}
console.log('BullMQ 5.78.1 Redis close compatibility patch verified.');
