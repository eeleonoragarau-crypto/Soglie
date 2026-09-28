import { makeAtmosphere } from '../src/lib/atmosphere.js'
import { SUN } from '../src/worlds/desert/layout.js'
const f = (a) => a.map((v) => v.toFixed(3)).join(', ')
for (const [label, o] of [['earth', {}], ['desert', { mie: 34e-6, shM: 1.6e3, mieAbs: [1, 0.86, 0.66], g: 0.8 }]]) {
  const A = makeAtmosphere(o)
  const [sx, sy, sz] = SUN
  console.log(label, 'sunT', f(A.sunTransmittance(sx, sy, sz)))
  console.log('  zenith', f(A.scatter(0, 1, 0, sx, sy, sz)))
  const hs = Math.hypot(sx, sz)
  console.log('  horizon toward sun', f(A.scatter((sx / hs) * 0.995, 0.1, (sz / hs) * 0.995, sx, sy, sz)))
  console.log('  near sun 3deg', f(A.scatter(sx, sy + 0.05, sz, sx, sy, sz)))
  console.log('  horizon away', f(A.scatter((-sx / hs) * 0.995, 0.1, (-sz / hs) * 0.995, sx, sy, sz)))
  console.log('  horizon side', f(A.scatter((-sz / hs) * 0.995, 0.05, (sx / hs) * 0.995, sx, sy, sz)))
  console.log('  30deg side', f(A.scatter((-sz / hs) * 0.86, 0.5, (sx / hs) * 0.86, sx, sy, sz)))
}
