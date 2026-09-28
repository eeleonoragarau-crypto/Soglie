// Names, colours, sigils and every line of text in the game.
// A key carries the sigil of the door it opens.

export const WORLDS = {
  desert: { name: 'Il Deserto', subtitle: 'Dove tutte le porte si incontrano' },
  sea: { name: 'Il Mare Immobile', subtitle: 'Primo universo', color: [0.55, 0.78, 1.0], palette: [[0.004, 0.008, 0.03], [0.05, 0.08, 0.22]] },
  crystal: { name: 'Il Giardino di Vetro', subtitle: 'Secondo universo', color: [1.0, 0.5, 0.78], palette: [[0.9, 0.62, 0.66], [0.62, 0.55, 0.95]] },
  void: { name: "L'Abisso", subtitle: 'Terzo universo', color: [0.72, 0.55, 1.0], palette: [[0.0, 0.0, 0.006], [0.12, 0.05, 0.22]] },
  garden: { name: 'Il Giardino Sospeso', subtitle: 'Quarto universo', color: [0.62, 1.0, 0.45], palette: [[0.16, 0.32, 0.08], [0.5, 0.72, 0.95]] },
  origin: { name: "L'Origine", subtitle: 'Oltre la Grande Soglia', color: [1.0, 0.9, 0.7], palette: [[0.9, 0.86, 0.8], [1.0, 0.98, 0.94]] },
}

export const KEYS = {
  sea: { name: 'la Chiave del Mare', glyph: 'sea', color: WORLDS.sea.color, door: 'sea' },
  crystal: { name: 'la Chiave di Vetro', glyph: 'crystal', color: WORLDS.crystal.color, door: 'crystal' },
  void: { name: "la Chiave dell'Abisso", glyph: 'void', color: WORLDS.void.color, door: 'void' },
  garden: { name: 'la Chiave del Giardino', glyph: 'garden', color: WORLDS.garden.color, door: 'garden' },
  gate: { name: 'il Seme', glyph: 'gate', color: WORLDS.origin.color, door: 'origin' },
}

export const KEY_ORDER = ['sea', 'crystal', 'void', 'garden', 'gate']

export const LINES = {
  intro: [
    'Cinque porte stanno in piedi nel deserto.',
    'Ognuna si apre su un altro universo.',
    'Ognuna attende la sua chiave.',
  ],
  firstHint: 'Ascolta. Le chiavi cantano.',
  locked: (sigilName) => `La porta non ti riconosce. Cerca ${sigilName}.`,
  lockedGate: 'La Grande Soglia dorme. Quattro universi devono ancora rispondere.',
  found: (name) => `Hai trovato ${name}.`,
  foundAfter: 'Da qualche parte, una porta ha sentito.',
  unlocking: 'La porta ti riconosce.',
  back: 'La porta alle tue spalle ti riporta al deserto.',
  storm: 'La tempesta non ti lascia passare.',
  sea: {
    hint: 'Nel Mare Immobile, ciò che cerchi esiste solo nel riflesso.',
    rise: 'Il riflesso sale in superficie.',
  },
  crystal: {
    hint: 'Tre cristalli ricordano un accordo. Svegliali.',
    ring: (n) => `${n} di 3.`,
    open: 'Il grande cristallo si apre.',
  },
  void: {
    hint: 'Il sentiero esiste solo sotto i tuoi passi. Segui le stelle.',
    fall: 'Il vuoto ti restituisce.',
  },
  garden: {
    hint: "Il Seme dorme dove l'acqua cade verso l'alto.",
    release: "L'acqua rallenta. Il Seme scende verso di te.",
  },
  gate: {
    wake: 'La Grande Soglia si è svegliata.',
  },
  origin: {
    end: [
      'Ogni porta era già aperta.',
      'Serviva soltanto qualcuno disposto ad attraversarla.',
    ],
  },
}
