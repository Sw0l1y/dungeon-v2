export class SwordSwing {
  /**
   * @param {number} dmgMult  – damage multiplier (1 = normal, >1 = overcharge)
   * @param {number} sizeMult – range & arc scale (1 = normal, >1 = overcharge)
   */
  constructor(level, x, y, dirX, dirY, owner, dmgMult = 1, sizeMult = 1) {
    this.level     = level;
    this.x         = x;
    this.y         = y;
    this.dirX      = dirX || 0;
    this.dirY      = dirY || 1;
    this.owner     = owner;
    this._dmgMult  = dmgMult;
    this._sizeMult = sizeMult;
    // Range grows with size, arc capped at 150° to stay readable
    this.range     = 80 * sizeMult;
    this.arcAngle  = Math.PI * (100 / 180) * Math.min(1.5, sizeMult); // up to 150°
    this._duration = 0.21;
    this._timer    = this._duration;
    this._hasHit   = false;
  }

  get _progress() { return 1 - this._timer / this._duration; }

  update(dt) {
    // Keep the swing anchored to the player as they move
    this.x = this.owner.x;
    this.y = this.owner.y;

    this._timer -= dt;

    // Hit detection at mid-swing
    if (!this._hasHit && this._timer < this._duration * 0.45) {
      this._hasHit = true;
      const base = Math.atan2(this.dirY, this.dirX);
      const half = this.arcAngle / 2;
      for (const e of [...this.level.entities]) {
        if (!e.isEnemy || !e.alive) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) > this.range + e.radius) continue;
        let diff = Math.atan2(e.y - this.y, e.x - this.x) - base;
        diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI; // wrap to [-π, π]
        if (Math.abs(diff) <= half) e.takeDamage(72 * this._dmgMult, this.owner, 'melee');
      }
    }

    if (this._timer <= 0) this.level.removeEntity(this);
  }

  // Draw one lightsaber blade at a given angle: outermost halo → mid glow → inner → white core
  _drawBlade(ctx, angle, alpha, color) {
    if (alpha < 0.01) return;
    const startR = 10; // leave a small gap at the player center
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x1  = this.x + cos * startR;
    const y1  = this.y + sin * startR;
    const x2  = this.x + cos * this.range;
    const y2  = this.y + sin * this.range;

    ctx.save();
    ctx.lineCap = 'round';

    // Layer 1 — wide outer halo (player color, very transparent)
    ctx.globalAlpha = alpha * 0.11;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 28;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    // Layer 2 — mid glow
    ctx.globalAlpha = alpha * 0.28;
    ctx.lineWidth   = 14;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    // Layer 3 — inner colored glow
    ctx.globalAlpha = alpha * 0.72;
    ctx.lineWidth   = 6;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    // Layer 4 — bright white core
    ctx.globalAlpha = alpha * 0.96;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    ctx.restore();
  }

  draw(ctx) {
    const p    = this._progress;
    const base = Math.atan2(this.dirY, this.dirX);
    const half = this.arcAngle / 2;

    const startAngle   = base - half;
    const currentAngle = startAngle + this.arcAngle * p;
    const color        = this.owner.color;

    // masterFade: full for most of the swing, then quickly disappears in the last ~20%
    const masterFade = Math.min(1, (1 - p) * 5);

    // ── Trail ──────────────────────────────────────────────────────────────────
    // Ghost blades from the arc's start up to the current blade position.
    // Oldest ghost (t=0) is at startAngle and nearly invisible;
    // most-recent ghost (t→1) is just behind the blade head.
    const TRAIL_N = 16;
    for (let i = 0; i < TRAIL_N; i++) {
      const t     = i / TRAIL_N;            // 0 = oldest, ~1 = near head
      const angle = startAngle + (currentAngle - startAngle) * t;
      const alpha = t * 0.60 * masterFade;  // linearly brighter toward head
      this._drawBlade(ctx, angle, alpha, color);
    }

    // ── Blade head ─────────────────────────────────────────────────────────────
    this._drawBlade(ctx, currentAngle, masterFade, color);
  }
}
