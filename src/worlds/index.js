// The four universes behind the desert doors, in the order the keys chain.
import { Sea } from './sea.js'
import { Crystal } from './crystal.js'
import { Void } from './void.js'
import { Garden } from './garden.js'

export const UNIVERSES = [
  { id: 'sea', World: Sea, next: 'crystal' },
  { id: 'crystal', World: Crystal, next: 'void' },
  { id: 'void', World: Void, next: 'garden' },
  { id: 'garden', World: Garden, next: 'gate' },
]
