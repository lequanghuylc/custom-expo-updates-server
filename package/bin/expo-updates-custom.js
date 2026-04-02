#!/usr/bin/env node
/* eslint-disable no-console */
const { run } = require('../lib/cli');

run(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
