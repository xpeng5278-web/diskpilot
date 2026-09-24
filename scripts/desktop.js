const { spawn } = require('node:child_process');
const { buildBridge } = require('./build-bridge');
const { startServer } = require('../src/server');

async function start() {
  const executable = await buildBridge();
  const server = await startServer();
  const helper = spawn(executable, []);
  helper.once('error', error => { console.error(error); server.close(); });
  helper.once('close', () => server.close());
  process.once('SIGINT', () => { helper.kill(); server.close(); });
  console.log(`DiskPilot: http://127.0.0.1:${server.address().port}`);
}

start().catch(error => { console.error(error); process.exitCode = 1; });
