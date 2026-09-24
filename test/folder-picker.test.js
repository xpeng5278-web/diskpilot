const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { chooseFolder } = require('../src/folder-picker');

test('desktop bridge returns an absolute Unicode folder path', { skip: process.platform !== 'win32' }, async () => {
  const expected = 'D:\\资料\\项目';
  const server = net.createServer(socket => {
    socket.once('data', data => {
      assert.equal(data.toString(), 'PICK\n');
      socket.end(Buffer.from(expected, 'utf8').toString('base64') + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { assert.equal(await chooseFolder(server.address().port), expected); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
