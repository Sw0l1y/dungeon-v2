export class EnemyProjectile {
  constructor(level, x, y, vx, vy) {
    this.level    = level;
    this.x        = x;
    this.y        = y;
    this.vx       = vx;
    this.vy       = vy;
    this.radius   = 7;
    this.damage   = 12;
    this._lifetime = 5;
    this.isEnemy  = false; // not a target for player weapons
  }

  update(dt) {
    this._lifetime -= dt;
    if (this._lifetime <= 0) { this.level.removeEntity(this); return; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Player hit
    for (const p of this.level.players) {
      if (!p.alive) continue;
      if (Math.hypot(this.x - p.x, this.y - p.y) < this.radius + p.radius) {
        p.takeDamage(this.damage);
        this.level.removeEntity(this);
        return;
      }
    }

    // Wall hit
    const { map, tileSize: ts } = this.level;
    const col = Math.floor(this.x / ts);
    const row = Math.floor(this.y / ts);
    if (row < 0 || row >= map.length || col < 0 || col >= map[0].length || map[row][col] === 1 || map[row][col] === 2) {
      this.level.removeEntity(this);
    }
  }

  draw(ctx) {
    const speed  = Math.hypot(this.vx, this.vy);
    const tx = this.x - (this.vx / speed) * 18;
    const ty = this.y - (this.vy / speed) * 18;

    // Trail glow
    const grad = ctx.createLinearGradient(tx, ty, this.x, this.y);
    grad.addColorStop(0, 'rgba(255,140,0,0)');
    grad.addColorStop(1, 'rgba(255,140,0,0.45)');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = this.radius * 1.4;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();

    // Outer glow ring
    const pulse = 0.35 + 0.15 * Math.sin(Date.now() / 120);
    ctx.strokeStyle = `rgba(255,160,0,${pulse})`;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + 3, 0, Math.PI * 2);
    ctx.stroke();

    // Core
    ctx.fillStyle = '#ffb833';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Bright center
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}
