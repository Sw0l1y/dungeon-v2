// Floor Key — drops from the main-boss on death.
// Players walk over it to collect; once collected game.state.floorKey = true.
// The portal in the exit room is locked until it's collected.

export class FloorKey {
  constructor(level, x, y) {
    this.level      = level;
    this.x          = x;
    this.y          = y;
    this.isFloorKey = true;
    this.alive      = true;
    this.radius     = 20;
    this._t         = 0;
    this.onCollect  = null;
  }

  update(dt) {
    this._t += dt;
    if (!this.alive) return;
    for (const pl of this.level.players) {
      if (!pl.alive) continue;
      if (Math.hypot(pl.x - this.x, pl.y - this.y) < this.radius + (pl.radius ?? 15)) {
        this.alive = false;
        this.level.removeEntity(this);
        this.onCollect?.();
        return;
      }
    }
  }

  draw(ctx) {
    if (!this.alive) return;
    const { x, _t: t } = this;
    const y     = this.y + Math.sin(t * 2.8) * 4;
    const pulse = 0.55 + 0.38 * Math.sin(t * 3.5);

    ctx.save();

    // outer glow
    const grd = ctx.createRadialGradient(x, y, 0, x, y, 32);
    grd.addColorStop(0,   `rgba(255,210,50,${pulse * 0.60})`);
    grd.addColorStop(0.5, `rgba(255,150,10,${pulse * 0.24})`);
    grd.addColorStop(1,   'rgba(255,100,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, 32, 0, Math.PI * 2); ctx.fill();

    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 1.1) * 0.14);

    // key bow (outer ring)
    ctx.strokeStyle = '#ffd24c';
    ctx.lineWidth   = 4;
    ctx.beginPath(); ctx.arc(0, -7, 9, 0, Math.PI * 2); ctx.stroke();
    // inner ring detail
    ctx.strokeStyle = '#ffb020';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.arc(0, -7, 4, 0, Math.PI * 2); ctx.stroke();

    // stem
    ctx.fillStyle = '#ffd24c';
    ctx.fillRect(-2.5, 0, 5, 18);
    // teeth
    ctx.fillRect(-2.5,  5, 8,   3.5);
    ctx.fillRect(-2.5, 12, 6,   3.5);

    // sparkles orbiting
    for (let i = 0; i < 5; i++) {
      const a  = t * 1.6 + i * (Math.PI * 2 / 5);
      const r  = 20 + 5 * Math.sin(t * 3 + i);
      const sa = 0.35 + 0.5 * Math.sin(t * 5 + i * 1.3);
      ctx.globalAlpha = sa;
      ctx.fillStyle   = '#fff7c0';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
