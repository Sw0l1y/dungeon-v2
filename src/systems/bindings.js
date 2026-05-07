/**
 * Key assignments per player slot.
 * Add a new entry here to support another player — nothing else needs to change.
 *
 * P1: WASD move | Space attack | Q abilityA | E interact
 * P2: IJKL move | Enter attack | U abilityA | O interact
 */
export const BINDINGS = {
  player1: {
    up:       'KeyW',
    down:     'KeyS',
    left:     'KeyA',
    right:    'KeyD',
    attack:   'Space',
    abilityA: 'KeyQ',
    interact: 'KeyE',
  },
  player2: {
    up:       'KeyI',
    down:     'KeyK',
    left:     'KeyJ',
    right:    'KeyL',
    attack:   'Enter',
    abilityA: 'KeyU',
    interact: 'KeyO',
  },
};
