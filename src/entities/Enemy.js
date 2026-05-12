import { astar } from '../systems/Pathfinding.js';

export class Enemy {
  constructor(level, x, y) {
    this.level  = level;
    this.x      = x;
    this.y      = y;
    this.radius = 12;
    this.speed  = 75;
    this.maxHp  = 70;
    this.hp     = 70;
    this.alive  = true;
    this.isEnemy  = true;
    this._typeIdx = 0;   // for net serialization: 0=Enemy
    this._netId   = 0;   // assigned by WaveManager
    this.damage   = 10;
    this._hitCooldown = 0;
    this._path        = [];
    this._pathTimer   = 0;
  }

  takeDamage(amount, source = null) {
    if (!this.alive) return;
    const dealt = Math.min(amount, this.hp);
    this.hp = Math.max(0, this.hp - amount);
    if (source) source.dmgDealt = (source.dmgDealt || 0) + dealt;
    if (this.hp === 0) this.die();
  }

  die() {
    this.alive = false;
    this.level.spawnDeathParticles(this.x, this.y, '#e03030', 12);
    this.level.removeEntity(this);
    const stats = this.level.game?.state?.stats;
    if (stats) stats.enemiesKilled++;
  }

  update(dt) {
    if (!this.alive) return;

    const players = this.level.players.filter(p => p.alive);
    if (players.length === 0) return;

    let nearest = null, nearestDist = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    }
    if (!nearest) return;

    // Refresh path periodically or when we've consumed all waypoints
    this._pathTimer -= dt;
    if (this._pathTimer <= 0 || this._path.length === 0) {
      this._pathTimer = 0.35;
      this._recalcPath(nearest);
    }

    const ts = this.level.tileSize;

    if (this._path.length > 0) {
      const wp = this._path[0];
      const tx = (wp.c + 0.5) * ts;
      const ty = (wp.r + 0.5) * ts;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist < ts * 0.35) {
        this._path.shift();
      } else {
        const nx = this.x + (dx / dist) * this.speed * dt;
        const ny = this.y + (dy / dist) * this.speed * dt;
        if (!this._collidesAt(nx, this.y)) this.x = nx;
        if (!this._collidesAt(this.x, ny)) this.y = ny;
      }
    } else {
      // Direct chase fallback (target is in same tile)
      const dx  = nearest.x - this.x;
      const dy  = nearest.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = this.x + (dx / len) * this.speed * dt;
      const ny = this.y + (dy / len) * this.speed * dt;
      if (!this._collidesAt(nx, this.y)) this.x = nx;
      if (!this._collidesAt(this.x, ny)) this.y = ny;
    }


    // Contact damage
    this._hitCooldown = Math.max(0, this._hitCooldown - dt);
    if (this._hitCooldown === 0) {
      for (const p of players) {
        if (Math.hypot(p.x - this.x, p.y - this.y) < this.radius + p.radius) {
          p.takeDamage(this.damage);
          this._hitCooldown = 0.8;
          break;
        }
      }
    }
  }

  _recalcPath(target) {
    const ts = this.level.tileSize;
    const sc = Math.floor(this.x / ts);
    const sr = Math.floor(this.y / ts);
    const ec = Math.floor(target.x / ts);
    const er = Math.floor(target.y / ts);
    this._path = astar(this.level.map, sc, sr, ec, er);
  }

  _collidesAt(x, y) {
    const r = this.radius - 2;
    const { map, tileSize: ts } = this.level;
    for (const [px, py] of [[x-r,y-r],[x+r,y-r],[x-r,y+r],[x+r,y+r]]) {
      const col = Math.floor(px / ts);
      const row = Math.floor(py / ts);
      if (row < 0 || row >= map.length || col < 0 || col >= map[0].length) return true;
      if (map[row][col] === 1 || map[row][col] === 2) return true;
    }
    return false;
  }

  draw(ctx) {
    // Glow ring
    ctx.strokeStyle = 'rgba(255,60,60,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + 4, 0, Math.PI * 2);
    ctx.stroke();

    // Body
    ctx.fillStyle = '#e03030';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Health bar
    const barW = 28, barH = 3;
    const barX = this.x - barW / 2;
    const barY = this.y - this.radius - 9;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    const pct = this.hp / this.maxHp;
    ctx.fillStyle = pct > 0.5 ? '#4cff72' : pct > 0.25 ? '#ffd24c' : '#ff4c4c';
    ctx.fillRect(barX, barY, barW * pct, barH);
  }
}
