export class SwordSwing {
  constructor(level, x, y, dirX, dirY, owner) {
    this.level    = level;
    this.x        = x;
    this.y        = y;
    this.dirX     = dirX || 0;
    this.dirY     = dirY || 1;
    this.owner    = owner;
    this.range    = 52;
    this.arcAngle = Math.PI * 0.78; // ~140°
    this._duration = 0.22;
    this._timer    = this._duration;
    this._hasHit   = false;
  }

  update(dt) {
    this._timer -= dt;

    // Check hits once at mid-swing
    if (!this._hasHit && this._timer < this._duration * 0.5) {
      this._hasHit = true;
      const base = Math.atan2(this.dirY, this.dirX);
      const half = this.arcAngle / 2;
      for (const e of [...this.level.entities]) {
        if (!e.isEnemy || !e.alive) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) > this.range + e.radius) continue;
        let diff = Math.atan2(e.y - this.y, e.x - this.x) - base;
        diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI; // wrap to [-π, π]
        if (Math.abs(diff) <= half) e.takeDamage(35);
      }
    }

    if (this._timer <= 0) this.level.removeEntity(this);
  }

  draw(ctx) {
    const progress  = 1 - this._timer / this._duration;
    const baseAngle = Math.atan2(this.dirY, this.dirX);
    const half      = this.arcAngle / 2;

    // Sweep arc from start to current progress
    const sweepEnd = baseAngle - half + this.arcAngle * progress;

    ctx.save();
    ctx.globalAlpha = 0.75 * (1 - progress * 0.6);
    ctx.strokeStyle = this.owner.color;
    ctx.lineWidth   = 8;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.range, baseAngle - half, sweepEnd);
    ctx.stroke();
    ctx.restore();
  }
}
