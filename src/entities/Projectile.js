export class Projectile {
  constructor(level, x, y, vx, vy, owner) {
    this.level    = level;
    this.x        = x;
    this.y        = y;
    this.vx       = vx;
    this.vy       = vy;
    this.owner    = owner;
    this.radius   = 5;
    this._lifetime = 3;
  }

  update(dt) {
    this._lifetime -= dt;
    if (this._lifetime <= 0) { this.level.removeEntity(this); return; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Enemy hit
    for (const e of [...this.level.entities]) {
      if (!e.isEnemy || !e.alive) continue;
      if (Math.hypot(this.x - e.x, this.y - e.y) < this.radius + e.radius) {
        e.die();
        this.level.removeEntity(this);
        return;
      }
    }

    // Wall hit
    const { map, tileSize: ts } = this.level;
    const col = Math.floor(this.x / ts);
    const row = Math.floor(this.y / ts);
    if (row < 0 || row >= map.length || col < 0 || col >= map[0].length || map[row][col] === 1) {
      this.level.removeEntity(this);
    }
  }

  draw(ctx) {
    // Trail
    const tx = this.x - (this.vx / 420) * 14;
    const ty = this.y - (this.vy / 420) * 14;
    ctx.fillStyle = this.owner.color + '55';
    ctx.beginPath();
    ctx.arc(tx, ty, this.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = this.owner.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
