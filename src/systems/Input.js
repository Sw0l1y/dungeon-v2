export class Input {
  constructor() {
    this._held = new Set();
    this._justPressed = new Set();
    this._justReleased = new Set();
    this._chars = []; // printable characters typed this frame (for text input)

    this._onKeyDown = (e) => {
      if (!this._held.has(e.code)) this._justPressed.add(e.code);
      this._held.add(e.code);
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this._chars.push(e.key);
      }
    };
    this._onKeyUp = (e) => {
      this._held.delete(e.code);
      this._justReleased.add(e.code);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /** True every frame the key is held. */
  isHeld(code) { return this._held.has(code); }

  /** True only on the first frame the key was pressed. */
  justPressed(code) { return this._justPressed.has(code); }

  /** True only on the first frame the key was released. */
  justReleased(code) { return this._justReleased.has(code); }

  /** Returns a {x, y} direction from WASD / arrow keys, normalized. */
  get axes() {
    let x = 0, y = 0;
    if (this._held.has('KeyA') || this._held.has('ArrowLeft'))  x -= 1;
    if (this._held.has('KeyD') || this._held.has('ArrowRight')) x += 1;
    if (this._held.has('KeyW') || this._held.has('ArrowUp'))    y -= 1;
    if (this._held.has('KeyS') || this._held.has('ArrowDown'))  y += 1;
    if (x !== 0 && y !== 0) {
      const len = Math.SQRT2;
      x /= len; y /= len;
    }
    return { x, y };
  }

  /** Printable characters typed this frame (for text input fields). */
  get chars() { return this._chars; }

  /** Called by Game at the end of each frame to clear one-frame sets. */
  flush() {
    this._justPressed.clear();
    this._justReleased.clear();
    this._chars = [];
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
