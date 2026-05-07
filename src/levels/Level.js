/** Base class for all levels. */
export class Level {
  constructor(game, name) {
    this.game     = game;
    this.name     = name;
    this.entities = [];
    this.players  = []; // all player entities
    this.player   = null; // primary player (first added), kept for compat
    this._debris  = [];  // wall-destruction particles
  }

  onEnter() {}
  onExit() {}

  update(dt) {
    for (const e of this.entities) e.update?.(dt);
    this._updateDebris(dt);
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
}
