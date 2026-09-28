# Soglie

An explorable first-person game in three.js. Golden-hour dunes under a ringed
planet, five monolith doors, five universes. Every door shows its universe live,
from the right angle, and you walk through it with no cut. Each universe hides
the key to the next door.

```
npm install
npm run dev        # http://127.0.0.1:5213
npm run build
```

## Play

WASD walk, mouse look, Shift run, Space jump, M audio, Esc pause. Going down a
steep dune you start sliding: that is the fastest way to travel (and the dunes
boom when you do). Headphones help: every key sings from where it lies.

1. **Il Deserto.** The first key waits near the half-buried ring, under a column of light.
2. **Il Mare Immobile.** Night, a sea so still it is a mirror. The key exists only in the reflection.
3. **Il Giardino di Vetro.** Dawn over a salt flat and giant crystals. Wake three singing crystals.
4. **L'Abisso.** Glass tiles over a galaxy, a black hole ahead, low gravity. The path exists only under your steps.
5. **Il Giardino Sospeso.** Floating islands; the Seed sleeps where water falls upward.
6. **La Grande Soglia** opens with the Seed onto **L'Origine**.

## How it works

- `src/engine/portal.js`: each door renders its destination world from a virtual
  eye (`dest * rotY(pi) * inverse(src) * camera`) with an oblique near plane on the
  far threshold, into a render target sampled in screen space by the door's
  surface. The surface is a thin box so the near plane never clips it while you
  step through. Crossing the threshold teleports the player through the same
  transform. From behind, an open door is just a door.
- Fog is portal-aware (`uFogClip` in `src/lib/glsl.js`): seen through a door, the
  other world's air only starts at the threshold.
- `src/worlds/desert/`: a 2048x2048 heightfield generated in a worker (asymmetric
  transverse dunes with slip faces), a camera-centred geometry clipmap with mip
  morphing, one baked GPU pass for normals, soft raymarched sun shadow and
  curvature, a static sun shadow map for the monoliths, and a Journey-style sand
  shader (ripples, glitter, footprints, cracked clay under the doors). Sky from a
  single-scattering atmosphere baked on the CPU, which also gives the sun colour
  and the ambient.
- Audio is entirely synthesised with Web Audio (`src/engine/audio.js`).
- `WORLD_API.md` explains how a universe is built.

## Tools

`tools/shot.mjs`, `walk.mjs`, `multi.mjs`, `playthrough.mjs`, `perf.mjs` drive
headless Chrome on the real GPU. URL params: `shot`, `world=<id>`, `only=<id>`,
`keys=a,b`, `pos=x,z,yaw,pitch`, `q=low|medium|high`, `tm=aces|agx|neutral`.

## Deploy

It is a static Vite site: build command `npm run build`, output folder `dist`.
On Vercel or Netlify, import the repo and keep the defaults for Vite. On GitHub
Pages, set `base` in `vite.config.js` to `'/<repo-name>/'` before building.
