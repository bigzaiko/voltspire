import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'path';

// Strict Content-Security-Policy for the published site (GitHub Pages cannot send headers,
// so it is delivered as a <meta> tag). Only our own files may run, plus Spotify's Web Playback SDK
// (loaded only after the player presses Connect Spotify). The network peers: the PeerJS matchmaking
// relay, Spotify's sign-in and Web API, and ReccoBeats for opt-in BPM lookups (GetSongBPM only when
// the build has a key for it).
const env = loadEnv('production', import.meta.dirname, 'VITE_');
// Spotify Connect is off unless the build sets VITE_SPOTIFY_CONNECT=1 (see README): its hosts are only allowed then
const spOn = env.VITE_SPOTIFY_CONNECT === '1';
const getSong = /^[A-Za-z0-9]{8,64}$/.test(env.VITE_GETSONGBPM_KEY || '') ? ' https://api.getsong.co' : '';
const CSP = [
  "default-src 'self'",
  "script-src 'self'" + (spOn ? ' https://sdk.scdn.co' : ''),
  "style-src 'self'",
  "font-src 'self'",
  // Spotify cover art (shown as delivered)
  "img-src 'self' data: blob:" + (spOn ? ' https://*.scdn.co https://*.spotifycdn.com' : ''),
  "media-src 'self'",
  "connect-src 'self' https://0.peerjs.com wss://0.peerjs.com " + (spOn ? 'https://accounts.spotify.com https://api.spotify.com ' : '') + "https://api.reccobeats.com" + getSong,
  "worker-src 'self' blob:",
  // the player's own playlist (Music sheet) plays in embeds from these hosts, and the Spotify SDK runs its player in a frame of its own
  "frame-src https://www.youtube-nocookie.com https://open.spotify.com" + (spOn ? ' https://sdk.scdn.co' : ''),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'beatspire-csp',
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
