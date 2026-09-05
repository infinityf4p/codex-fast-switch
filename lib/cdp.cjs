const { EventEmitter } = require('node:events');
class CdpPipe extends EventEmitter {
  constructor(child) {
    super();
    this.child = child;
    this.sequence = 0;
    this.pending = new Map();
    this.closed = false;
    let buffer = '';
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\0')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { this.close(new Error('Invalid CDP message')); return; }
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        } else this.emit('message', message);
      }
    });
    for (const pipe of [child.stdio[3], child.stdio[4]]) pipe.on('error', error => this.close(error));
    child.once('exit', () => this.close(new Error('Test app exited')));
    child.once('error', error => this.close(error));
  }
  call(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('App connection is closed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0', error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }
  close(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
module.exports = { CdpPipe };
