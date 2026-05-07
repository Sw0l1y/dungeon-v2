/** Base class for all levels. */
export class Level {
  constructor(game, name) {
    this.game     = game;
    this.name     = name;
    this.entities = [];
    this.players  = []; // all player entities
    this.player   = null; // primary player (first added), kept for compat
    this._debris      = [];  // wall-destruction particles
    this._soulDebris  = [];  // enemy-death soul fragments (permanent until portal-absorbed)
  }

  onEnter() {}
  onExit() {}

  update(dt) {
    for (const e of this.entities) e.update?.(dt);
    this._updateDebris(dt);
    this._updateSoulDebris(dt);
  }

  draw(ctx) {
    for (const e of this.entities) e.draw?.(ctx);
  }

  addEntity(entity) {
    this.entities.push(entity);
    return entity;
  }

  addPlayer(playerEntity) {
    if (!this.player) this.player = playerEntity;
    this.players.push(playerEntity);
    return this.addEntity(playerEntity);
  }

  removeEntity(entity) {
    this.entities = this.entities.filter(e => e !== entity);
    this.players  = this.players.filter(e => e !== entity);
    if (this.player === entity) this.player = this.players[0] ?? null;
  }

  /** Destroy a destructible wall tile (type 2) and spawn debris particles. */
  destroyWall(col, row) {
    if (!this.map?.[row]?.[col] || this.map[row][col] !== 2) return;
    this.map[row][col] = 0;
    const ts = this.tileSize ?? 40;
    const cx = (col + 0.5) * ts;
    const cy = (row + 0.5) * ts;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
      const s = 40 + Math.random() * 80;
      this._debris.push({
        x: cx + (Math.random() - 0.5) * ts * 0.5,
        y: cy + (Math.random() - 0.5) * ts * 0.5,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        size: 3 + Math.random() * 4,
      });
    }
  }

  _updateDebris(dt) {
    for (const d of this._debris) {
      d.x    += d.vx * dt;
      d.y    += d.vy * dt;
      d.vx   *= 0.88;
      d.vy   *= 0.88;
      d.life -= dt;
    }
    this._debris = this._debris.filter(d => d.life > 0);
  }

  _drawDebris(ctx) {
    for (const d of this._debris) {
      const a = Math.max(0, d.life / d.maxLife);
      ctx.fillStyle = `rgba(160,110,50,${a * 0.85})`;
      ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
    }
  }

  // ── Soul fragments (enemy death particles) ─────────────────────────────────

  /**
   * Burst `count` glowing soul fragments outward from (x, y).
   * Fragments are permanent until absorbed by the portal.
   * @param {number} x
   * @param {number} y
   * @param {string} color  — CSS colour matching the enemy type
   * @param {number} count
   */
  spawnDeathParticles(x, y, color, count) {
    // Soft cap — drop oldest when pool is full
    const CAP = 600;
    for (let i = 0; i < count; i++) {
      if (this._soulDebris.length >= CAP) this._soulDebris.shift();
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.9;
      const speed = 80 + Math.random() * 160;
      const life  = 20 + Math.random() * 14;
      this._soulDebris.push({
        x:    x + (Math.random() - 0.5) * 10,
        y:    y + (Math.random() - 0.5) * 10,
        vx:   Math.cos(angle) * speed,
        vy:   Math.sin(angle) * speed,
        size: 2.2 + Math.random() * 2.8,
        color,
        life,
        maxLife: life,
      });
    }
  }

  _updateSoulDebris(dt) {
    // Decay friction — burst settles quickly, then portal gravity dominates
    const friction = Math.pow(0.28, dt);
    for (const d of this._soulDebris) {
      d.vx  *= friction;
      d.vy  *= friction;
      d.x   += d.vx * dt;
      d.y   += d.vy * dt;
      d.life -= dt;
    }
    this._soulDebris = this._soulDebris.filter(d => d.life > 0);
  }

  _drawSoulDebris(ctx) {
    for (const d of this._soulDebris) {
      // Gentle fade-out only in last 2 s (so they look solid while alive)
      const alpha = Math.min(1, d.life / 2) * 0.92;
      if (alpha < 0.02) continue;

      // Outer glow
      ctx.globalAlpha = alpha * 0.38;
      ctx.fillStyle   = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size * 2.0, 0, Math.PI * 2);
      ctx.fill();

      // Solid core
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
