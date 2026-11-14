# VOLTSPIRE

**Build the grid. Become the storm.** A cyberpunk tower defense where your ultimate drops you onto the towers as a third-person archer. Plays free in the browser.

**Play:** https://bigzaiko.github.io/voltspire/

- **Command view** — build and upgrade six tower types beside the road; a Colossus arrives every fifth wave.
- **Uplink** — kills charge your ultimate. Press Space to become Kestrel on any tower: rapid arrows, Rail Shot, Arrow Rain, Singularity, and teleporting between towers.
- **Cards** — every level, pick one of three: tower blueprints, dedicated upgrades for each tower type, hero powers, economy. The bow evolves through five tiers.
- **Maps and modes** — six pre-made maps (one to three roads), three difficulties, a 20-wave Campaign and an endless Survival mode.
- **Map editor** — draw roads, place the core, wreckage and starting towers, set credits and core integrity; save locally and share maps as a code.
- **Multiplayer** — online co-op for two, or 1v1 where you pay to send squads at your rival. Join with a room code.

## Safe by design

No accounts, no login, no ads, no tracking, no server of ours. The site is static files with a strict Content-Security-Policy; all code and fonts are bundled. Multiplayer connects two browsers directly (WebRTC); the public PeerJS relay is only used to introduce them, and every message from the other player is validated before use. Peer-to-peer means the other player can see your IP address, so share room codes only with people you trust.

## Develop

```bash
npm install
npm run dev        # http://localhost:5183
npm run build      # static site in dist/
node tools/balance.ts 5 1 hero all normal   # headless bot runs for balancing
node tools/smoke.ts        # headless checks: maps, hostile input, co-op sync
node tools/trailer.mjs     # records the trailer from the running dev server
```

Models are generated procedurally with Blender: `blender -b --python tools/blender/build_models.py`.

Built with Three.js, TypeScript, Vite, PeerJS and Blender. MIT licensed.
