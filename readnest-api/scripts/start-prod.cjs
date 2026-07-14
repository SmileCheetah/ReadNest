#!/usr/bin/env node

if (!process.env.NODE_ENV || process.env.NODE_ENV.trim().length === 0) {
  process.env.NODE_ENV = 'production';
}

require('../dist/main.js');
