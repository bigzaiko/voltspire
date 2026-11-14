import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'path';

// Strict Content-Security-Policy for the published site (GitHub Pages cannot send headers,
// so it is delivered as a <meta> tag). Only our own files may run. The only network peer
// allowed is the PeerJS matchmaking relay that introduces two players to each other.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "connect-src 'self' https://0.peerjs.com wss://0.peerjs.com",
  "worker-src 'self' blob:",
  // the player's own playlist (Music sheet) plays in embeds from these two hosts and nowhere else
  "frame-src https://www.youtube-nocookie.com https://open.spotify.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'voltspire-csp',
  apply: 'build',
  // A tag descriptor, not a text replace: it still lands in the head when the head tag is written differently.
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  // Never ship a page without the policy.
  generateBundle: {
    order: 'post',
    handler(_opts, bundle) {
      let pages = 0;
      for (const f of Object.values(bundle)) {
        if (f.type !== 'asset' || !f.fileName.endsWith('.html')) continue;
        pages++;
        const html = typeof f.source === 'string' ? f.source : Buffer.from(f.source).toString('utf8');
        if (!html.includes('http-equiv="Content-Security-Policy"')) throw new Error(`${f.fileName} was built without a Content-Security-Policy`);
      }
      if (!pages) throw new Error('no built page found to check for the Content-Security-Policy');
    },
  },
});

export default defineConfig({
  base: './',
  plugins: [csp()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        play: resolve(import.meta.dirname, 'play.html'),
      },
    },
  },
  server: { port: 5183, strictPort: true },
});
