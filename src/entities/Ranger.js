import { astar } from '../systems/Pathfinding.js';
import { EnemyProjectile } from './EnemyProjectile.js';

export class Ranger {
  constructor(level, x, y) {
    this.level    = level;
    this.x        = x;
    this.y        = y;
    this.radius   = 13;
    this.speed    = 55;
    this.maxHp    = 90;
    this.hp       = 90;
    this.alive    = true;
    this.isEnemy  = true;
    this._typeIdx = 2;   // for net serialization: 2=Ranger
    this._netId   = 0;
    this.damage   = 8; // contact damage (rare)
    this._preferDist  = 220;
    this._minDist     = 140;
    this._shootCooldown = 1.5; // initial delay before first shot
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
    this.level.spawnDeathParticles(this.x, this.y, '#ff8c00', 10);
    this.level.removeEntity(this);
    const stats = this.level.game?.state?.stats;
    if (stats) stats.enemiesKilled++;
  }

  update(dt) {
    if (!this.alive) return;

    const players = this.level.players.filter(p => p.alive);
    if (players.length === 0) return;

    // Target nearest player
    let nearest = null, nearestDist = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    }
    if (!nearest) return;

    const hasLos = this._hasLos(nearest);
    const dist   = nearestDist;

    if (dist < this._minDist) {
      // Too close — back away directly (no pathfinding, just push back)
      const dx  = this.x - nearest.x;
      const dy  = this.y - nearest.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx  = this.x + (dx / len) * this.speed * dt;
      const ny  = this.y + (dy / len) * this.speed * dt;
      if (!this._collidesAt(nx, this.y)) this.x = nx;
      if (!this._collidesAt(this.x, ny)) this.y = ny;
    } else if (!hasLos || dist > this._preferDist) {
      // Need to close distance or find line of sight — use pathfinding
      this._pathTimer -= dt;
      if (this._pathTimer <= 0 || this._path.length === 0) {
        this._pathTimer = 0.4;
        this._recalcPath(nearest);
      }
      const ts = this.level.tileSize;
      if (this._path.length > 0) {
        const wp   = this._path[0];
        const tx   = (wp.c + 0.5) * ts;
        const ty   = (wp.r + 0.5) * ts;
        const dx   = tx - this.x;
        const dy   = ty - this.y;
        const d2   = Math.hypot(dx, dy);
        if (d2 < ts * 0.35) {
          this._path.shift();
        } else {
          const nx = this.x + (dx / d2) * this.speed * dt;
          const ny = this.y + (dy / d2) * this.speed * dt;
          if (!this._collidesAt(nx, this.y)) this.x = nx;
          if (!this._collidesAt(this.x, ny)) this.y = ny;
        }
      }
    }
    // else: in good range with LOS — hold position, just shoot

    // Shooting logic
    this._shootCooldown = Math.max(0, this._shootCooldown - dt);
    if (this._shootCooldown === 0 && hasLos && dist <= this._preferDist + 40 && dist >= this._minDist) {
      this._shootCooldown = 2.5;
      const dx  = nearest.x - this.x;
      const dy  = nearest.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      const speed = 130;
      this.level.addEntity(new EnemyProjectile(this.level, this.x, this.y, (dx / len) * speed, (dy / len) * speed));
    }


    // Contact damage (fallback — shouldn't happen often)
    this._hitCooldown = Math.max(0, this._hitCooldown - dt);
    if (this._hitCooldown === 0) {
      for (const p of players) {
        if (Math.hypot(p.x - this.x, p.y - this.y) < this.radius + p.radius) {
          p.takeDamage(this.damage);
          this._hitCooldown = 1.0;
          break;
        }
      }
    }
  }

  _hasLos(target) {
    const { map, tileSize: ts } = this.level;
    const dx    = target.x - this.x;
    const dy    = target.y - this.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / (ts * 0.4));
    for (let i = 1; i < steps; i++) {
      const t   = i / steps;
      const col = Math.floor((this.x + dx * t) / ts);
      const row = Math.floor((this.y + dy * t) / ts);
      if (map[row]?.[col] > 0) return false;
    }
    return true;
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
    // Glow ring — orange
    ctx.strokeStyle = 'rgba(255,130,0,0.4)';
    ctx.lineWidth   = 4;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
    ctx.stroke();

    // Body
    ctx.fillStyle = '#ff8c00';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Eye dot (shows intent — faces last shot direction, or just center)
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Health bar
    this._drawHealthBar(ctx);
  }

  _drawHealthBar(ctx) {
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
