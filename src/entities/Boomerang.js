export class Boomerang {
  constructor(level, x, y, vx, vy, owner) {
    this.level      = level;
    this.x          = x;
    this.y          = y;
    this.vx         = vx;
    this.vy         = vy;
    this.owner      = owner;
    this.radius     = 8;
    this.damage     = 22;
    this._returning = false;
    this._outTimer  = 0.55;
    this._lifetime  = 3.0;
    this._hitSet    = new Set();
    this._rotation  = 0;
    this._speed     = Math.hypot(vx, vy);
    this._prevX     = x;
    this._prevY     = y;
    this._bounced   = false;   // wall-ricochet used
  }

  update(dt) {
    this._lifetime -= dt;
    if (this._lifetime <= 0) { this.level.removeEntity(this); return; }

    this._rotation += dt * 11;

    if (!this._returning) {
      this._outTimer -= dt;
      if (this._outTimer <= 0) {
        this._returning = true;
        this._hitSet.clear();
      }
    }

    if (this._returning) {
      const dx   = this.owner.x - this.x;
      const dy   = this.owner.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 18) { this.level.removeEntity(this); return; }
      this.vx = (dx / dist) * this._speed;
      this.vy = (dy / dist) * this._speed;
    }

    this._prevX = this.x;
    this._prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Enemy hit
    for (const e of [...this.level.entities]) {
      if (!e.isEnemy || !e.alive || this._hitSet.has(e)) continue;
      if (Math.hypot(this.x - e.x, this.y - e.y) < this.radius + e.radius) {
        e.takeDamage(this.damage, this.owner, 'ranged');
        this._hitSet.add(e);
      }
    }

    // Wall hit
    if (!this._noclip) {
      const { map, tileSize: ts } = this.level;
      const col     = Math.floor(this.x / ts);
      const row     = Math.floor(this.y / ts);
      const hitWall = row < 0 || row >= map.length || col < 0 || col >= map[0].length
                    || map[row][col] === 1 || map[row][col] === 2;
      if (hitWall) {
        if (!this._returning && this._canRicochet && !this._bounced) {
          // Reflect off wall normal, reset hit set so return pass is fresh
          const prevCol = Math.floor(this._prevX / ts);
          const prevRow = Math.floor(this._prevY / ts);
          if (prevCol !== col) this.vx = -this.vx;
          if (prevRow !== row) this.vy = -this.vy;
          if (prevCol === col && prevRow === row) { this.vx = -this.vx; this.vy = -this.vy; }
          this.x = this._prevX;
          this.y = this._prevY;
          this._bounced = true;
          this._hitSet.clear();
        } else if (!this._returning) {
          this._returning = true;
          this._hitSet.clear();
        } else {
          this.level.removeEntity(this);
        }
      }
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this._rotation);

    const color = this.owner.color;

    // Outer glow
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 12;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Outer wing arc
    ctx.globalAlpha = 0.88;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 1.45);
    ctx.stroke();

    // Inner wing arc
    ctx.globalAlpha = 0.65;
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 0.52, Math.PI * 0.18, Math.PI * 1.08);
    ctx.stroke();

    // White center dot
    ctx.globalAlpha = 0.95;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
