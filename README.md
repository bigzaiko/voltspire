# BEATSPIRE

**Build the grid. Become the storm.** A tower defense on a hex grid where your own factory keeps the towers firing. Plays free in the browser, with mouse and keyboard or touch.

**Play:** https://bigzaiko.github.io/beatspire/

- **Towers** - build and upgrade ten tower types on the hexes beside the roads. Tags over the spawn gates show what the next wave sends down each road. A Colossus arrives every fifth wave, a Gyre mini-boss in between.
- **Supply** - a tower fires only what it is fed, and it starts empty. Supply crates on the deck feed a tower built next to them until they run out. The Pulse Turret runs on iron ore straight from a Mine; every later tower adds one step: power (Cryo, Arc, Beacon), crude oil by pipe (Firewall Pylon), smelted copper plates (Railgun), pressed shells (Mortar), energy cells (Lance, Graviton Well), missiles (Missile Battery). A tower that runs dry stops firing and shows what it is missing.
- **The factory** - deposits of iron, copper, coal and oil on every map. Twelve buildings, each with one job: Mine, Generator, Power Pole, Pumpjack, Pipe, Smelter, Frame Works, Shell Press, Cell Plant, Refinery, Missile Works and the Conveyor Belt. A run starts with only the Mine and the Belt; each blueprint card unlocks a tower together with the buildings its supply needs, tier by tier.
- **Logistics** - nothing has an output side. A building hands what it makes to a neighbour that needs it, or to a belt beside it when something further down that belt needs it, so belts never fill with things nobody wants. Towers and buildings take what they need from a belt that points at them or runs past them: one belt feeds a row of towers. Pipes carry crude oil and petrol. Power poles wire up to 5 tiles apart (also across roads) and power everything within 2 tiles. The Underpass card lets belts and pipes cross under a road.
- **Waves on call** - no wave starts by itself unless you switch Auto waves on, and the first one never does.
- **Tutorial** - the first solo run walks through crate, turret, mine, belt, cards and power; it can be replayed from How to play.
- **Credits and materials** - kills and cleared waves pay credits. A Frame Works turns iron plates into building materials, which the stronger towers and their upgrades cost on top.
- **Tower specials** - every tower charges a special. Select a charged tower and fire it (Space or the button in its panel). The tower then reboots for a few seconds.
- **Machines** - ten kinds, among them the Gyre (a wheel whose spinning rim deflects hits until you slow or freeze it), the Broodcarrier (its mites climb a tower and jam it) and the Titan: one finale per campaign that lands on the gate, wipes the road and stuns every tower. Its hull turns most tower fire; tower specials hit it at full strength.
- **Cards** - every level, pick one of three: tower blueprints, upgrades for each tower type, factory upgrades, economy.
- **Maps and modes** - 38 pre-made maps in three tiers (one to three roads, some with ramps and bridges) or a generated map from a seed. Three difficulties with 20, 25 or 30 waves, and a Survival mode with no last wave.
- **Map editor** - draw roads on the hex grid, place the core, wreckage and starting towers, set credits and core integrity. Deposits are laid out on the free deck automatically. Maps are saved locally and can be shared as a code.
- **Multiplayer** - online co-op and 1v1 are switched off for now: the factory is not kept in sync between two browsers yet. The code for them is still there.
- **Music** - five built-in synthwave tracks (92 to 108 BPM). Tick the ones you want and they play one after another as your playlist, or add YouTube and Spotify links of your own.
- **Settings** - volume, graphics quality, and the impact and beat pulse effects (on or off, where they show, intensity, colour). Records per map and difficulty are kept in the browser.

## Safe by design

No accounts, no login, no ads, no tracking, no server of ours. The site is static files with a strict Content-Security-Policy. All code and fonts are bundled. The only third-party content is the YouTube or Spotify player, and it loads only when you add a link to the playlist and press play. Multiplayer connects two browsers directly (WebRTC). The public PeerJS relay is only used to introduce them, and every message from the other player is validated before use. Peer-to-peer means the other player can see your IP address, so share room codes only with people you trust.

## Develop

```bash
npm install
npm run dev        # http://localhost:5183
npm run build      # static site in dist/
node tools/balance.ts               # headless bot runs for balancing (see the file for its arguments)
node tools/smoke.ts        # headless checks: maps, the factory, hostile input, co-op sync
node tools/hex-test.ts     # hex grid maths
node tools/mapgen-test.ts  # map generator
node tools/trailer.mjs     # records the trailer from the running dev server
```

Models are generated procedurally with Blender: `blender -b --python tools/blender/build_models.py`.

Built with Three.js, TypeScript, Vite, PeerJS and Blender. MIT licensed.
