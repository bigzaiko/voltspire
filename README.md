# BEATSPIRE

**Build the grid. Become the storm.** A tower defense on a hex grid where your ultimate puts you on a tower as a third-person archer. Plays free in the browser, with mouse and keyboard or touch.

**Play:** https://bigzaiko.github.io/beatspire/

- **Command view** - build and upgrade eleven tower types on the hexes beside the roads. Tags over the spawn gates show what the next wave sends down each road. A Colossus arrives every fifth wave, a Gyre mini-boss in between.
- **Uplink** - kills charge your ultimate. Press Space to stand on an Uplink Spire as Kestrel: arrows, Rail Shot, Arrow Rain, Singularity. She can only use Spires and teleports between them.
- **Tower specials** - every combat tower charges a special. During the Uplink, shoot the power node on top of a charged tower to fire it. The tower then reboots for a few seconds.
- **Weak points** - Brutes and the Colossus have exposed spots that take extra arrow damage.
- **Machines** - ten kinds, among them the Gyre (a wheel whose spinning rim deflects hits until you slow or freeze it), the Broodcarrier (its mites climb a tower and jam it until you shoot them off) and the Titan: one finale per campaign that lands on the gate, wipes the road and stuns every tower. Towers only slow it; your weak-point shots and tower specials bring it down, and the Uplink stays open while it stands.
- **Cards** - every level, pick one of three: tower blueprints, upgrades for each tower type, hero powers, economy. The bow changes through five tiers.
- **Maps and modes** - 38 pre-made maps in three tiers (one to three roads, some with ramps and bridges) or a generated map from a seed. Three difficulties with 20, 25 or 30 waves, and a Survival mode with no last wave.
- **Map editor** - draw roads on the hex grid, place the core, wreckage and starting towers, set credits and core integrity. Maps are saved locally and can be shared as a code.
- **Multiplayer** - online co-op for two, or 1v1 where you pay to send squads at your rival. Join with a room code.
- **Music** - five built-in synthwave tracks (92 to 108 BPM, a different one each run), or your own playlist of YouTube and Spotify links.
- **Settings** - volume, look sensitivity, graphics quality, and the impact and beat pulse effects (on or off, where they show, intensity, colour). Records per map and difficulty are kept in the browser.

## Safe by design

No accounts, no login, no ads, no tracking, no server of ours. The site is static files with a strict Content-Security-Policy. All code and fonts are bundled. The only third-party content is the YouTube or Spotify player, and it loads only when you add a link to the playlist and press play. Multiplayer connects two browsers directly (WebRTC). The public PeerJS relay is only used to introduce them, and every message from the other player is validated before use. Peer-to-peer means the other player can see your IP address, so share room codes only with people you trust.

## Develop

```bash
npm install
npm run dev        # http://localhost:5183
npm run build      # static site in dist/
node tools/balance.ts 5 1 hero all normal   # headless bot runs for balancing
node tools/smoke.ts        # headless checks: maps, hostile input, co-op sync
node tools/hex-test.ts     # hex grid maths
node tools/mapgen-test.ts  # map generator
node tools/trailer.mjs     # records the trailer from the running dev server
```

Models are generated procedurally with Blender: `blender -b --python tools/blender/build_models.py`.

Built with Three.js, TypeScript, Vite, PeerJS and Blender. MIT licensed.
