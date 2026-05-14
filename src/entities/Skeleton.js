import { astar } from '../systems/Pathfinding.js';

export class Skeleton {
  constructor(level, x, y, owner) {
    this.level     = level;
    this.x         = x;
    this.y         = y;
    this.owner     = owner;
    this.radius    = 11;
    this.speed     = 95;
    const baseHp   = owner?.game?.state?.upgrades?.boneArmor ? 120 : 60;
    this.maxHp     = baseHp;
    this.hp        = baseHp;
    this.alive     = true;
    this.isMinion  = true;
    this._atkCooldown = 0;
    this._atkRange    = 22;
    this._path        = [];
    this._pathTimer   = 0;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) this.die();
  }

  die() {
    this.alive = false;
    this.level.spawnDeathParticles?.(this.x, this.y, '#a0d8a0', 7);
    this.level.removeEntity(this);
    if (this.owner) {
      this.owner._skeletons = this.owner._skeletons.filter(s => s !== this);
      // Death Pact: explode for AoE on death
      if (this.owner.game?.state?.upgrades?.deathPact) {
        this.level.spawnDeathParticles?.(this.x, this.y, '#44ff88', 18);
        for (const e of [...this.level.entities]) {
          if (!e.isEnemy || !e.alive) continue;
          if (Math.hypot(e.x - this.x, e.y - this.y) < 90) {
            e.takeDamage(40, this.owner, 'melee');
          }
        }
      }
    }
  }

  update(dt) {
    if (!this.alive) return;
    this._atkCooldown = Math.max(0, this._atkCooldown - dt);
    this._pathTimer   -= dt;

    const enemies = this.level.entities.filter(e => e.isEnemy && e.alive);
    if (enemies.length === 0) return;

    let target = null, bestDist = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < bestDist) { bestDist = d; target = e; }
    }
    if (!target) return;

    // Melee attack when in range
    if (bestDist < this.radius + target.radius + this._atkRange) {
      if (this._atkCooldown === 0) {
        target.takeDamage(20, this.owner, 'melee');
        this._atkCooldown = 1.0;
      }
      return;
    }

    // Pathfind toward target
    if (this._pathTimer <= 0 || this._path.length === 0) {
      this._pathTimer = 0.45;
      const ts = this.level.tileSize;
      const sc = Math.floor(this.x / ts);
      const sr = Math.floor(this.y / ts);
      const ec = Math.floor(target.x / ts);
      const er = Math.floor(target.y / ts);
      this._path = astar(this.level.map, sc, sr, ec, er);
    }

    const ts = this.level.tileSize;
    if (this._path.length > 0) {
      const wp   = this._path[0];
      const tx   = (wp.c + 0.5) * ts;
      const ty   = (wp.r + 0.5) * ts;
      const dx   = tx - this.x;
      const dy   = ty - this.y;
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
      const dx  = target.x - this.x;
      const dy  = target.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx  = this.x + (dx / len) * this.speed * dt;
      const ny  = this.y + (dy / len) * this.speed * dt;
      if (!this._collidesAt(nx, this.y)) this.x = nx;
      if (!this._collidesAt(this.x, ny)) this.y = ny;
    }
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
    ctx.save();

    // Green minion aura
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#44ff88';
    ctx.lineWidth   = 5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
    ctx.stroke();

    // Bone-white body
    ctx.globalAlpha = 1;
    ctx.fillStyle   = '#ccd5c0';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Dark skull outline
    ctx.strokeStyle = '#556655';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Eye sockets
    ctx.fillStyle = '#1a2a1a';
    ctx.beginPath();
    ctx.arc(this.x - 3.5, this.y - 2, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.x + 3.5, this.y - 2, 2.8, 0, Math.PI * 2);
    ctx.fill();

    // Glowing eye pupils
    ctx.fillStyle   = '#44ff88';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(this.x - 3.5, this.y - 2, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.x + 3.5, this.y - 2, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Health bar
    const barW = 26, barH = 3;
    const barX = this.x - barW / 2;
    const barY = this.y - this.radius - 8;
    ctx.globalAlpha = 1;
    ctx.fillStyle   = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#44ff88';
    ctx.fillRect(barX, barY, barW * (this.hp / this.maxHp), barH);

    ctx.restore();
  }
}
