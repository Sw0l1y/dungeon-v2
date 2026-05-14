import { Projectile } from './Projectile.js';

export class NecroShot extends Projectile {
  constructor(level, x, y, vx, vy, owner) {
    super(level, x, y, vx, vy, owner);
    this.damage    = 15;
    this.radius    = 7;
    this._lifetime = 2.5;
  }

  draw(ctx) {
    const t     = Date.now() / 320;
    const pulse = 0.82 + 0.18 * Math.sin(t);

    ctx.save();

    // Wide outer halo
    ctx.globalAlpha = 0.15;
    ctx.fillStyle   = '#9b59b6';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Mid glow
    ctx.globalAlpha = 0.42 * pulse;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Core orb
    ctx.globalAlpha = 0.90;
    ctx.fillStyle   = '#c39bd3';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // White center
    ctx.globalAlpha = 0.88;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
