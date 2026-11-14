import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'path';

// Strict Content-Security-Policy for the published site (GitHub Pages cannot send headers,
// so it is delivered as a <meta> tag). Only our own files may run; the only network peers
// allowed are the PeerJS matchmaking relay used to introduce two players to each other.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "connect-src 'self' https://0.peerjs.com wss://0.peerjs.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'voltspire-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
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
