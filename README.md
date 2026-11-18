# BEATSPIRE

**Build the grid. Become the storm.** A hex-grid tower defense where no gun fires for free: every bolt, shell and missile is dug, smelted and carried to it by the factory you build between the roads. Plays free in the browser, with mouse and keyboard or touch.

**Play:** https://bigzaiko.github.io/beatspire/

![A working factory between the roads of Switchback: mines and a curved belt feed a row of Pulse Turrets while a wave comes down the road](public/media/shot-factory.jpg)

| | | |
|---|---|---|
| ![The build phase: a Pulse Turret ghost by the belt, supply cues on every building](public/media/shot-build.jpg) | ![The Titan walking past the factory after its landing](public/media/shot-titan.jpg) | ![A Cryo Emitter's Flash Freeze: machines in shells of ice](public/media/shot-cryo.jpg) |
| ![A Colossus pushing down the west road](public/media/shot-colossus.jpg) | ![The map editor with deposits and the Resources tool](public/media/shot-editor.jpg) | ![Late wave from the bird camera](public/media/shot-bird.jpg) |
| ![The Level Up screen with three cards](public/media/shot-cards.jpg) | ![The game on a phone in landscape with the touch HUD](public/media/shot-phone.jpg) | [![The trailer's closing card](public/media/poster.jpg)](public/media/trailer.mp4) |

- **Towers** - build and upgrade ten tower types on the hexes beside the roads. Tags over the spawn gates show what the next wave sends down each road. A Colossus arrives every fifth wave, a Gyre mini-boss in between.
- **Supply** - a tower fires only what it is fed, and it starts empty. It keeps one item in hand and pulls the next off its belt or pipe as it fires. Supply crates on the deck feed a tower built next to them until they run out. The Pulse Turret runs on iron ore straight from a Mine; every later tower adds one step: power (Cryo, Arc, Beacon), crude oil by pipe (Firewall Pylon), smelted copper plates (Railgun), pressed shells (Mortar), energy cells (Lance, Graviton Well), missiles (Missile Battery). A tower that runs dry stops firing and shows what it is missing. At Mk3 the Pulse Turret fires plasma shells and the Firewall Pylon burns petrol, so their supply line grows with them.
- **The factory** - deposits of iron, copper, coal and oil on every map. Fifteen buildings, each with one job: Mine, Generator, Power Pole, Pumpjack, Pipe, Pipe Tunnel, Smelter, Frame Works, Shell Press, Cell Plant, Refinery, Missile Works, Conveyor Belt, Belt Splitter and Belt Tunnel. A run starts with only the Mine and the Belt; each blueprint card unlocks a tower together with the buildings its supply needs, tier by tier. Production is slow on purpose (a mine digs an ore about every 3 seconds, about what one turret burns): mines, pumpjacks, plants and generators upgrade twice for credits to work faster.
- **Logistics** - nothing has an output side. A building hands what it makes to a neighbour that needs it, or to a belt beside it when something further down that belt needs it, so belts never fill with things nobody wants. Towers and buildings take what they need from a belt that points at them or runs past them: one belt feeds a row of towers. Pipes carry crude oil and petrol. Power poles wire up to 5 tiles apart (also across roads) and power everything within 2 tiles. Belts merge where one points into another; a Belt Splitter (from the first tier-2 blueprint) deals items out to several lines. The Tunnels card unlocks Belt and Pipe Tunnels that pass up to 4 tiles under roads, towers and buildings.
- **Waves on call, time stands still between them** - no wave starts by itself unless you switch Auto waves on, and the first one never does. Between waves nothing is made and nothing moves: a broken rust ring with a hologram of the missing item marks every tower and building that will lack something when the wave starts, its panel lists what feeds it and what is missing, and the Power gauge shows what the grids need against what they have. While you place a piece, green rings mark everything that will be supplied, dashes run along the route the piece would get and brackets close on what it would feed or power; hold V to see the green rings at any time.
- **Tutorial** - a guided run on Switchback through crate, turret, mine, belt, cards and power. It is the second button in the menu, the first solo run starts it by itself, and it can be replayed from How to play.
- **Upgrades** - towers go to Mk3 for credits (the heavy ones for building materials too); mines, pumpjacks, plants and generators upgrade twice and work 1.6 and 2.3 times as fast.
- **Credits and materials** - kills and cleared waves pay credits. A Frame Works turns iron plates into building materials, which the stronger towers and their upgrades cost on top.
- **Tower specials** - every tower charges a special. Select a charged tower and fire it (Space or the button in its panel). The tower then reboots for a few seconds.
- **Machines** - nine kinds and the mites, among them the Gyre (a wheel whose spinning rim deflects hits until you slow or freeze it), the Broodcarrier (its mites climb a tower and jam it) and the Titan: one finale per campaign that lands on the gate, wipes the road and stuns every tower. Its hull turns most tower fire; tower specials hit it at full strength.
- **Cards** - every level, pick one of three out of 63: tower blueprints, upgrades for each tower type, factory upgrades, economy.
- **Maps and modes** - 38 pre-made maps in three tiers (one to three roads, some with ramps and bridges) or a generated map from a seed. Three difficulties with 20, 25 or 30 waves, and a Survival mode with no last wave.
- **Map editor** - draw up to three roads on the hex grid, raise them into ramps and bridges, place the core, wreckage and starting towers, set credits and core integrity. The Resources tool paints iron, copper, coal and oil deposits, or leaves them to the rules that lay them out automatically; the editor shows the deposits and crates a run would start with and warns when something is missing. Maps are saved locally and can be shared as a code.
- **Multiplayer** - online co-op and 1v1 are switched off for now: the factory is not kept in sync between two browsers yet. The code for them is still there, and they are coming back.
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
```

Media for the landing page and this README are rendered from the running dev server on the GPU (headless Chromium, ffmpeg):

```bash
node tools/previews.mjs    # tower, machine, factory building and deposit stills + the hover clips (public/media, public/media/prev)
node tools/shot.mjs        # gallery screenshots (shot-*.jpg); names as arguments for some of them
node tools/trailer.mjs     # trailer.mp4 with the game's own score and sounds, and poster.jpg
```

The landing page also loads smaller copies (`public/media/sm/`, picked by `srcset`) and a lighter hero background (`hero.jpg`). Remake them after the stills or screenshots change:

```bash
cd public/media && mkdir -p sm
for f in shot-*.jpg; do ffmpeg -y -loglevel error -i $f -vf scale=960:-2:flags=lanczos -q:v 5 sm/$f; done
for f in tower_*.jpg enemy_*.jpg fac_*.jpg dep_*.jpg; do ffmpeg -y -loglevel error -i $f -vf scale=320:-2:flags=lanczos -q:v 4 sm/$f; done
ffmpeg -y -loglevel error -i shot-factory.jpg -q:v 9 hero.jpg
```

The landing page (`index.html`, `src/landing.ts`, `src/landing.css`) holds only the copy. Its tower, machine and factory cards, the supply-chain diagram and the numbers in the hero are built by `src/landing.ts` from `src/game/data.ts` (and a few constants of `factory.ts` and `map.ts`), so a balance change shows up on the page with the next build.

Models are generated procedurally with Blender: `blender -b --python tools/blender/build_models.py`.

Built with Three.js, TypeScript, Vite, PeerJS and Blender. MIT licensed.
