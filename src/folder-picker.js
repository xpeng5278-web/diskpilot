const net = require('node:net');

const port = 4175;

function chooseFolder(bridgePort = port) {
  if (process.platform !== 'win32') return Promise.reject(new Error('文件夹选择器目前仅支持 Windows'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: bridgePort });
    let value = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2 * 60 * 1000, () => socket.destroy(new Error('文件夹选择超时，请重试')));
    socket.on('connect', () => socket.write('PICK\n'));
    socket.on('data', chunk => {
      value += chunk;
      if (value.length > 131072) socket.destroy(new Error('文件夹路径过长'));
    });
    socket.once('end', () => {
      const encoded = value.trim();
      resolve(encoded ? Buffer.from(encoded, 'base64').toString('utf8') : null);
    });
    socket.once('error', error => {
      reject(['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM'].includes(error.code)
        ? new Error('桌面助手未连接，请运行 npm run desktop 或重新打开桌面助手') : error);
    });
  });
}

module.exports = { chooseFolder };
