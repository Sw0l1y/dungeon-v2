import { Projectile } from './Projectile.js';

export class HomingArrow extends Projectile {
  constructor(level, x, y, vx, vy, owner, target = null) {
    super(level, x, y, vx, vy, owner);
    this.target = target;
    this.radius = 4;
    this.damage = 18;
    this._lifetime = 2.6;
    this._turnRate = 8.5;
    this._avoidStrength = 260;
  }

  update(dt) {
    this._lifetime -= dt;
    if (this._lifetime <= 0) { this.level.removeEntity(this); return; }

    if (!this.target?.alive || !this.level.entities.includes(this.target)) {
      this.target = this._pickTarget();
    }

    const speed = Math.hypot(this.vx, this.vy) || 1;
    let steerX = 0;
    let steerY = 0;

    if (this.target?.alive) {
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      steerX += dx / len;
      steerY += dy / len;
    }

    const avoid = this._wallAvoidance();
    steerX += avoid.x;
    steerY += avoid.y;

    const steerLen = Math.hypot(steerX, steerY);
    if (steerLen > 0.001) {
      const desiredX = (steerX / steerLen) * speed;
      const desiredY = (steerY / steerLen) * speed;
      const t = 1 - Math.exp(-this._turnRate * dt);
      this.vx += (desiredX - this.vx) * t;
      this.vy += (desiredY - this.vy) * t;
      const nextSpeed = Math.hypot(this.vx, this.vy) || 1;
      this.vx = (this.vx / nextSpeed) * speed;
      this.vy = (this.vy / nextSpeed) * speed;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const spd = Math.hypot(this.vx, this.vy) || 1;
    this._trail.push({ x: this.x, y: this.y, dx: this.vx / spd, dy: this.vy / spd });
    if (this._trail.length > 10) this._trail.shift();

    for (const e of [...this.level.entities]) {
      if (!e.isEnemy || !e.alive) continue;
      if (Math.hypot(this.x - e.x, this.y - e.y) < this.radius + e.radius) {
        e.takeDamage(this.damage, this.owner, 'ranged');
        this.level.removeEntity(this);
        return;
      }
    }

    const { map, tileSize: ts } = this.level;
    const col = Math.floor(this.x / ts);
    const row = Math.floor(this.y / ts);
    if (row < 0 || row >= map.length || col < 0 || col >= map[0].length || map[row][col] === 1 || map[row][col] === 2) {
      if (!this._noclip) this.level.removeEntity(this);
    }
  }

  _pickTarget() {
    let best = null;
    let bestDist = Infinity;
    for (const e of this.level.entities) {
      if (!e.isEnemy || !e.alive) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < bestDist) { bestDist = d; best = e; }
    }
    return best;
  }

  _wallAvoidance() {
    const { map, tileSize: ts } = this.level;
    const aheadLen = 46;
    const sideLen = 30;
    const speed = Math.hypot(this.vx, this.vy) || 1;
    const dx = this.vx / speed;
    const dy = this.vy / speed;
    const px = -dy;
    const py = dx;
    let ax = 0;
    let ay = 0;

    const probes = [
      { x: this.x + dx * aheadLen, y: this.y + dy * aheadLen, push: 1.25 },
      { x: this.x + dx * sideLen + px * 18, y: this.y + dy * sideLen + py * 18, push: 0.8 },
      { x: this.x + dx * sideLen - px * 18, y: this.y + dy * sideLen - py * 18, push: 0.8 },
    ];

    for (const p of probes) {
      const col = Math.floor(p.x / ts);
      const row = Math.floor(p.y / ts);
      if (row < 0 || row >= map.length || col < 0 || col >= map[0].length || map[row][col] === 1 || map[row][col] === 2) {
        const cx = (col + 0.5) * ts;
        const cy = (row + 0.5) * ts;
        const awayX = this.x - cx;
        const awayY = this.y - cy;
        const len = Math.hypot(awayX, awayY) || 1;
        ax += (awayX / len) * p.push;
        ay += (awayY / len) * p.push;
      }
    }

    return { x: ax * (this._avoidStrength / 260), y: ay * (this._avoidStrength / 260) };
  }

  draw(ctx) {
    const speed = Math.hypot(this.vx, this.vy) || 1;
    const dx = this.vx / speed;
    const dy = this.vy / speed;
    const px = -dy;
    const py =  dx;

    // Trail — each point uses its own stored direction so curves render correctly
    const n = this._trail.length;
    for (let i = 0; i < n; i++) {
      const pos   = this._trail[i];
      const tdx   = pos.dx ?? dx;
      const tdy   = pos.dy ?? dy;
      const alpha = ((i + 1) / (n + 1)) * 0.35;
      this._drawArrow(ctx, pos.x, pos.y, tdx, tdy, -tdy, tdx, alpha);
    }

    // Main arrow head
    this._drawArrow(ctx, this.x, this.y, dx, dy, px, py, 1);
  }
}
