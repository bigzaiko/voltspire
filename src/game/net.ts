// Peer-to-peer link (WebRTC via PeerJS). No accounts, no game server: two browsers talk directly.
// Everything received is untrusted and must be validated by the caller.
import type { Peer, DataConnection } from 'peerjs';

const PREFIX = 'voltspire-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export type Msg = { t: string; [k: string]: unknown };

export class Net {
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  isHost = false;
  code = '';
  onOpen: () => void = () => {};
  onClose: (why: string) => void = () => {};
  onMsg: (m: Msg) => void = () => {};
  private count = 0; private windowStart = 0; private closed = false;

  private async mk(id?: string) {
    const { Peer } = await import('peerjs');
    return id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
  }
  private wire(conn: DataConnection) {
    this.conn = conn;
    conn.on('open', () => this.onOpen());
    conn.on('data', (d) => {
      // flood guard: drop anything beyond 400 messages per second
      const now = performance.now();
      if (now - this.windowStart > 1000) { this.windowStart = now; this.count = 0; }
      if (++this.count > 400) return;
      if (d && typeof d === 'object' && !Array.isArray(d) && typeof (d as Msg).t === 'string') this.onMsg(d as Msg);
    });
    conn.on('close', () => this.fail('The other player disconnected.'));
    conn.on('error', () => this.fail('Connection error.'));
  }
  private fail(why: string) { if (this.closed) return; this.closed = true; this.onClose(why); }

  /** Open a room and resolve with its code. */
  async host(): Promise<string> {
    this.isHost = true;
    const buf = new Uint32Array(6);
    crypto.getRandomValues(buf);
    this.code = [...buf].map((n) => ALPHA[n % ALPHA.length]).join('');
    const peer = (this.peer = await this.mk(PREFIX + this.code));
    return new Promise((res, rej) => {
      peer.on('open', () => res(this.code));
      peer.on('error', (e) => { rej(e); this.fail('Could not reach the matchmaking relay.'); });
      peer.on('connection', (c) => {
        if (this.conn) { c.close(); return; } // one guest only
        this.wire(c);
      });
    });
  }
  async join(code: string): Promise<void> {
    this.isHost = false; this.code = cleanCode(code);
    const peer = (this.peer = await this.mk());
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout')), 15000);
      peer.on('open', () => {
        const c = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
        c.on('open', () => { clearTimeout(to); res(); });
        this.wire(c);
      });
      peer.on('error', (e) => { clearTimeout(to); rej(e); });
    });
  }
  send(m: Msg) { if (this.conn && this.conn.open) this.conn.send(m); }
  close() {
    this.closed = true;
    try { this.conn?.close(); this.peer?.destroy(); } catch { /* already gone */ }
    this.conn = null; this.peer = null;
  }
}
