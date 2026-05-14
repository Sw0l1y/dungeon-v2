export class Decoy {
  constructor(level, x, y, owner) {
    this.level    = level;
    this.x        = x;
    this.y        = y;
    this.owner    = owner;
    this.radius   = 10;
    this._lifetime = 4.0;
    this.isDecoy  = true;
    this.alive    = true;
    this.hp       = 1;  // enemies "attack" decoy via contact; we just remove it on timer
  }

  update(dt) {
    this._lifetime -= dt;
    if (this._lifetime <= 0) {
      this.alive = false;
      this.level.removeEntity(this);
    }
  }

  draw(ctx) {
    const fadeAlpha = Math.min(1, this._lifetime * 1.5);
    const pulse     = 0.72 + 0.18 * Math.sin(Date.now() / 280);

    ctx.save();

    // Outer ping ring — expands slowly
    const pingR = this.radius + 14 + 6 * Math.sin(Date.now() / 420);
    ctx.globalAlpha = fadeAlpha * 0.22;
    ctx.strokeStyle = this.owner.color;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, pingR, 0, Math.PI * 2);
    ctx.stroke();

    // Body ring
    ctx.globalAlpha = fadeAlpha * 0.55 * pulse;
    ctx.strokeStyle = this.owner.color;
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + 4, 0, Math.PI * 2);
    ctx.stroke();

    // Ghost body fill
    ctx.globalAlpha = fadeAlpha * 0.32 * pulse;
    ctx.fillStyle   = this.owner.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // "DECOY" label
    ctx.globalAlpha = fadeAlpha * 0.70;
    ctx.fillStyle   = this.owner.color;
    ctx.font        = 'bold 9px "Trebuchet MS", sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('DECOY', this.x, this.y - this.radius - 4);

    ctx.restore();
  }
}
