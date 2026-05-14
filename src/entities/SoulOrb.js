export class SoulOrb {
  constructor(level, x, y) {
    this.level     = level;
    this.x         = x;
    this.y         = y;
    this.radius    = 6;
    this._vy       = -18;          // gentle upward drift
    this._lifetime = 14.0;
    this.isSoulOrb = true;
    this.alive     = true;
  }

  update(dt) {
    this._lifetime -= dt;
    if (this._lifetime <= 0) { this.alive = false; this.level.removeEntity(this); return; }

    // Drift upward then settle
    this._vy += (0 - this._vy) * Math.min(1, dt * 3);
    this.y   += this._vy * dt;

    // Auto-collect by any nearby necromancer
    for (const p of this.level.players) {
      if (!p.alive || p.classId !== 'necromancer') continue;
      if (Math.hypot(p.x - this.x, p.y - this.y) < p.radius + this.radius + 22) {
        if (p._orbCount < p._maxOrbs) {
          p._orbCount++;
          this.alive = false;
          this.level.removeEntity(this);
          return;
        }
      }
    }
  }

  draw(ctx) {
    const t     = Date.now() / 380;
    const pulse = 0.78 + 0.22 * Math.sin(t);
    const fade  = Math.min(1, this._lifetime * 0.8);

    ctx.save();

    // Outer halo
    ctx.globalAlpha = fade * 0.18 * pulse;
    ctx.fillStyle   = '#b84fff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 2.8, 0, Math.PI * 2);
    ctx.fill();

    // Mid glow
    ctx.globalAlpha = fade * 0.45 * pulse;
    ctx.fillStyle   = '#9b59b6';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.globalAlpha = fade * 0.92;
    ctx.fillStyle   = '#d7a8ff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // White center spark
    ctx.globalAlpha = fade * 0.88;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.36, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
