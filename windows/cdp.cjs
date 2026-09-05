const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Windows Chromium uses a loopback DevTools socket for the isolated UI probe.
class CdpSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return this.close(new Error('Invalid CDP message')); }
      const pending = this.pending.get(message.id);
      if (!pending) return this.emit('message', message);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => this.close(new Error('Test app connection closed')));
    socket.addEventListener('error', () => this.close(new Error('Test app connection failed')));
  }
  call(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('Test app connection is closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close(error = new Error('Test completed')) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.socket.close();
  }
  static async connect(child, profile) {
    const deadline = Date.now() + 45000;
    const file = path.join(profile, 'DevToolsActivePort');
    while (!fs.existsSync(file)) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Test app exited before DevTools became available.');
      if (Date.now() >= deadline) throw new Error('Test app did not expose its loopback DevTools socket.');
      await delay(200);
    }
    const [port, endpoint] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !/^\/devtools\/browser\/[a-f0-9-]+$/.test(endpoint)) {
      throw new Error('Invalid local DevTools address.');
    }
    const socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
    const cdp = new CdpSocket(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cdp.close(); reject(new Error('DevTools connection timed out')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools connection failed')); }, { once: true });
    });
    child.once('exit', () => cdp.close(new Error('Test app exited')));
    return cdp;
  }
}
module.exports = { CdpSocket };
