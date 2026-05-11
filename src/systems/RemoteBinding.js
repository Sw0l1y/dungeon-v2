/**
 * RemoteBinding — a fake InputBinding driven by network packets instead of keyboard.
 *
 * Implements the same interface as InputBinding so Player.update() / game code
 * doesn't need to know whether a player is local or remote.
 *
 * Usage:
 *   const rb = new RemoteBinding();
 *   // On network packet:
 *   rb.applyRemote({ x: 0.7, y: -0.5, ak: 1, it: 0 });
 *   // End of each frame:
 *   rb.flush();
 */
export class RemoteBinding {
  constructor() {
    // Minimal _bindings map so revive-label code (which reads _bindings.interact)
    // shows a sensible key name for the remote player.
    this._bindings = { interact: 'KeyO' };

    this._axes = { x: 0, y: 0 };
    this._heldAk = false;
    this._heldIt = false;
    this._heldAb = false;
    this._jpAk   = false;   // justPressed — cleared by flush()
    this._jpIt   = false;
    this._jpAb   = false;
    this._jrAk   = false;   // justReleased — cleared by flush()
    this._jrIt   = false;
    this._jrAb   = false;
  }

  /**
   * Apply an input packet received from the network.
   * { x, y, ak, it, ab }  — axes + attack-held + interact-held + ability-pressed (0/1)
   */
  applyRemote({ x = 0, y = 0, ak = 0, it = 0, ab = 0 }) {
    const newAk = !!ak;
    const newIt = !!it;
    const newAb = !!ab;
    // Compute transitions before updating held state
    this._jpAk = !this._heldAk && newAk;
    this._jpIt = !this._heldIt && newIt;
    this._jpAb = newAb;  // ability is a latch (already a one-shot from client)
    this._jrAk = this._heldAk  && !newAk;
    this._jrIt = this._heldIt  && !newIt;
    this._jrAb = false;
    this._heldAk = newAk;
    this._heldIt = newIt;
    this._heldAb = newAb;
    this._axes   = { x, y };
  }

  // ── InputBinding interface ─────────────────────────────────────────────────

  isHeld(action) {
    if (action === 'attack')   return this._heldAk;
    if (action === 'interact') return this._heldIt;
    if (action === 'abilityA') return this._heldAb;
    return false;
  }

  justPressed(action) {
    if (action === 'attack')   return this._jpAk;
    if (action === 'interact') return this._jpIt;
    if (action === 'abilityA') return this._jpAb;
    return false;
  }

  justReleased(action) {
    if (action === 'attack')   return this._jrAk;
    if (action === 'interact') return this._jrIt;
    return false;
  }

  get axes() { return this._axes; }

  /**
   * Clear one-shot flags.  Call once per game frame (after Player.update),
   * mirroring how Input.flush() clears justPressed/justReleased.
   */
  flush() {
    this._jpAk = false;
    this._jpIt = false;
    this._jpAb = false;
    this._jrAk = false;
    this._jrIt = false;
    this._jrAb = false;
  }
}
