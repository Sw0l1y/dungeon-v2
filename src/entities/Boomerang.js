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
    this._bounced   = false;
    this._trail     = [];
  }

  update(dt) {
    this._lifetime -= dt;
    if (this._lifetime <= 0) { this.level.removeEntity(this); return; }

    this._rotation += dt * (this._returning ? 16 : 11);
    this._trail.push({ x: this.x, y: this.y });
    if (this._trail.length > 9) this._trail.shift();

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
    const color = this.owner.color;

    // Motion trail
    ctx.save();
    for (let i = 0; i < this._trail.length; i++) {
      const t = this._trail[i];
      const frac = i / this._trail.length;
      ctx.globalAlpha = frac * 0.28;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 3.5 * frac, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this._rotation);

    const isRet = this._returning;

    // Outer glow — brighter on return pass
    ctx.globalAlpha = isRet ? 0.38 : 0.18;
    ctx.shadowColor = color;
    ctx.shadowBlur  = isRet ? 20 : 10;
    ctx.strokeStyle = color;
    ctx.lineWidth   = isRet ? 16 : 10;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Wing 1 — main arm (0°)
    const drawWing = () => {
      const W = 14, thick = 4.5, curve = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.quadraticCurveTo(W * 0.5, -curve - 1, W, -thick * 0.5);
      ctx.quadraticCurveTo(W * 1.08, 0, W, thick * 0.5 + 1);
      ctx.quadraticCurveTo(W * 0.5, curve, 0, 1);
      ctx.closePath();
      ctx.fill();

      // Highlight stripe along the wing top edge
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.2;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(1, -0.5);
      ctx.quadraticCurveTo(W * 0.5, -curve - 2, W - 1, -thick * 0.3);
      ctx.stroke();
    };

    ctx.globalAlpha = 0.92;
    ctx.fillStyle   = color;
    drawWing();

    // Wing 2 — second arm (~130° off)
    ctx.save();
    ctx.rotate(Math.PI * 0.72);
    ctx.globalAlpha = 0.88;
    ctx.fillStyle   = color;
    drawWing();
    ctx.restore();

    // Center rivet
    ctx.globalAlpha = 1;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
