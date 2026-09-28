# Soglie: how a universe is built

Soglie is a first-person game in vanilla three.js (r186) + postprocessing. A golden
desert hub (`src/worlds/desert/`) holds five monolith doors. Four open onto
universes, one (the Great Gate) onto the finale. Each door shows its universe
live and you walk through it seamlessly. Each universe hides the key for the
next door.

```
desert --(key sea)--> sea --(key crystal)--> crystal --(key void)--> void --(key garden)--> garden --(key gate: the Seed)--> Great Gate
```

## Run and look

```bash
npm run dev                                  # http://127.0.0.1:5213
PORT=5221 NOHMR=1 npx vite                   # your own server, no auto-reload
PORT=5221 node tools/shot.mjs "shot&world=crystal" shots/crystal-1.png 3000
```

URL params: `shot` (skip title, no pointer lock), `world=<id>` (start inside a
universe at its `spawn`), `only=<id>` (build desert + only that universe, others
become stand-ins, faster), `keys=a,b` (start holding keys), `pos=x,z,yaw,pitch`
(desert only), `dev`.

Place the camera anywhere with `EVAL` (runs after load, before the wait):

```bash
EVAL="(()=>{const g=window.__soglie; g.player.place(10,0,40,Math.PI); g.player.pitch=0.1; return 1})()" \
  PORT=5221 node tools/shot.mjs "shot&world=crystal&only=crystal" shots/c2.png 2500
```

`tools/walk.mjs` holds W for a while and screenshots during the walk. Headless
Chrome uses the real GPU (Metal); fps is capped near 30 there, so use
`renderer.info` (calls, triangles) printed by shot.mjs as the budget signal.

To see your universe *through its door from the desert*, stand in front of the
desert door with its key (it unlocks by itself within ~14 m, takes 5 s):

```bash
EVAL="(()=>{const g=window.__soglie,d=g.worlds.desert.doors.crystal,p=d.group.position,n=d.normal; g.player.place(p.x+n.x*9,p.y,p.z+n.z*9,d.yaw); g.player.pitch=0.1; return 1})()" \
  PORT=5221 node tools/shot.mjs "shot&keys=crystal&only=crystal" shots/c-door.png 7000
```

## The contract

```js
import { World } from '../engine/world.js'
import { makeEnv } from '../engine/env.js'
import { makeSkyDome } from '../engine/skydome.js'
import { addDoor } from '../engine/door.js'
import { KeyItem } from '../engine/key.js'
import { makeStoneMaterial, makeGlowMaterial, litVertex } from '../engine/materials.js'
import { noise, fog, hash } from '../lib/glsl.js'
import { WORLDS, KEYS, LINES } from '../story.js'
import { registerAmbience } from '../engine/audio.js'

export class Crystal extends World {
  constructor(game) {
    super(game, { id: 'crystal', ...WORLDS.crystal })
    this.surface = 'crystal'   // footstep voice: sand | water | glass | crystal | grass
    this.slopePhysics = false  // sand-surfing physics only make sense on dunes
    this.gravity = 20; this.jump = 6.8
    this.grade = { exposure: 1, bloom: 0.8, saturation: 1.05, contrast: 1.04, grain: 0.03, haze: 0 }
  }
  async build(renderer) {
    this.env = makeEnv({ ... })          // FIRST: every material reads it
    this.scene.add(makeSkyDome({ uniforms: {...this.env.uniforms, ...}, body: 'vec3 skyColor(vec3 d){...}' }))
    // ... geometry ...
    this.door = addDoor(this, { id: 'crystal-return', x, y, z, yaw, locked: false,
      color: WORLDS.crystal.color, glyph: KEYS.crystal.glyph,
      palette: [[0.6, 0.32, 0.14], [0.35, 0.5, 0.75]] })   // stand-in colours = the desert
    this.key = new KeyItem(this, { id: 'void', ...KEYS.void, x, y, z, hidden: true })
    this.spawn = { x, y, z, yaw }        // used by ?world=; put it in front of the door
  }
  groundAt(x, z, y) { return 0 }         // height under the feet, or null = no ground (you fall)
  normalAt(x, z, out) { return out.set(0, 1, 0) }
  constrain(pos, vel, dt) {}             // bounds, respawn after a fall, etc.
  onStep(x, z, heading, speed) {}        // footprints, ripples
  update(dt, t, game) { super.update(dt, t); /* animate */ }
  onEnter(game) {}                       // first time: game.hud.say(LINES.crystal.hint, 6)
}
```

Rules that keep everything seamless:

1. **No three.js lights, fog or shadow maps.** Lighting is custom GLSL reading
   the env uniforms: `uSunDir`, `uSunColor`, `uAmbTop`, `uAmbHorizon`,
   `uAmbGround`, plus fog `uFogColor`, `uFogDensity`, `uFogBase`, `uFogFalloff`,
   `uFogSun`. Every material spreads `...this.env.uniforms`, passes
   `defines: { ...this.env.defines }`, includes the `fog` chunk and ends with
   `col = applyFog(col, vWorld)` (or `fogFrom()` for additive glows). This is
   what makes the fog start at the threshold when your world is seen through
   a door.
2. **GLSL3 ShaderMaterials**, `out vec4 fragColor`, linear HDR output. Tone
   mapping (ACES), bloom, grain and vignette happen afterwards.
3. **Use `cameraPosition`, never a player uniform.** The world is also rendered
   from a portal's virtual eye. Camera-centred things (sky, particles,
   instanced grass fields) must follow `cameraPosition` in the shader or use
   `mesh.onBeforeRender = (r, s, camera) => ...`.
4. Everything visible must live in `this.scene`.
5. Gameplay only when the player is inside: `if (game && game.current === this)`.
   `update()` also runs while the world is merely seen through a door.
6. Colliders: `this.colliders.push({ type: 'circle', x, z, r })` or
   `{ type: 'box', x, z, c: cos(yaw), s: sin(yaw), hx, hz, y0, y1 }`.
   `addDoor` already registers the door jambs.
7. Keys: `new KeyItem(world, { id, ...KEYS[id], x, y, z, hidden, beam, radius })`.
   `hidden: true` = invisible and cannot be picked up; call `key.reveal()`.
   The player picks it up by walking into it. `beam: 0` removes the light column.
8. Text: `game.hud.say(text, seconds)`. Existing lines live in `story.js`
   (`LINES.<id>`). Italian, calm, no em dashes, never italic.
9. Audio: `registerAmbience('<id>', (A, out) => ({ update(dt, game, inside) {} }))`
   at module level. `A.ctx`, `A.src(A.noise | A.brown)`, `A.bell(freq, when,
   amp, dur, dest)`, `A.reverb`. Connect your nodes into `out`. The engine
   crossfades it when you cross, and leaks it through the door when open.
10. A mirror-sea trick exists (`makeEnv({ water: 0.62 })` + objects under a
    group with `scale.y = -1`): see `src/worlds/sea.js`.

Budget per universe: about 60 draw calls, 300k triangles, no per-frame
allocations, one expensive full-screen effect at most (the sky dome counts).
The door frame is 2.6 m x 10.5 m of opening in a 5.1 m x 12.9 m slab; the
player's eye is at 1.68 m and walks at 4.6 m/s (9.2 running).
