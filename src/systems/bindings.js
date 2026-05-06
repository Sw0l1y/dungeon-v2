/**
 * Key assignments per player slot.
 * Add a new entry here to support another player — nothing else needs to change.
 */
export const BINDINGS = {
  player1: {
    up:      'KeyW',
    down:    'KeyS',
    left:    'KeyA',
    right:   'KeyD',
    actionA: 'KeyQ',  // e.g. dodge / ability 1
    actionB: 'KeyE',  // e.g. interact / ability 2
  },
  player2: {
    up:      'KeyI',
    down:    'KeyK',
    left:    'KeyJ',
    right:   'KeyL',
    actionA: 'KeyU',
    actionB: 'KeyP',
  },
};
