/**
 * Per-player action layer over the raw Input singleton.
 * Exposes named actions (up/down/left/right/actionA/actionB) instead of key codes,
 * so game code never hard-codes keys and remapping is just a bindings.js change.
 */
export class InputBinding {
  constructor(input, bindings) {
    this._input    = input;
    this._bindings = bindings;
  }

  isHeld(action) {
    const code = this._bindings[action];
    return code ? this._input.isHeld(code) : false;
  }

  justPressed(action) {
    const code = this._bindings[action];
    return code ? this._input.justPressed(code) : false;
  }

  justReleased(action) {
    const code = this._bindings[action];
    return code ? this._input.justReleased(code) : false;
  }

  /** Normalized {x, y} movement vector from the directional actions. */
  get axes() {
    let x = 0, y = 0;
    if (this.isHeld('left'))  x -= 1;
    if (this.isHeld('right')) x += 1;
    if (this.isHeld('up'))    y -= 1;
    if (this.isHeld('down'))  y += 1;
    if (x !== 0 && y !== 0) {
      x /= Math.SQRT2;
      y /= Math.SQRT2;
    }
    return { x, y };
  }
}
