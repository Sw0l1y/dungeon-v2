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
    this._separateEnemies();
    this._updateDebris(dt);
    this._updateSoulDebris(dt);
  }

  // Run enemy-separation once per frame as an O(n*(n-1)/2) pair pass rather
  // than having each enemy iterate all entities independently (was O(n²/frame)).
  _separateEnemies() {
    const ents = this.entities;
    const n = ents.length;
    for (let i = 0; i < n; i++) {
      const a = ents[i];
      if (!a.isEnemy || !a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = ents[j];
        if (!b.isEnemy || !b.alive) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy;
        const min = a.radius + b.radius;
        if (dist2 < min * min && dist2 > 0) {
          const dist = Math.sqrt(dist2);
          const push = (min - dist) / 2 / dist;
          a.x += dx * push;
          a.y += dy * push;
          b.x -= dx * push;
          b.y -= dy * push;
        }
      }
    }
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

  // ── Enemy-death body fragments ────────────────────────────────────────────

  /**
   * Burst `count` physical body-chunk fragments outward from (x, y).
   * Each is an irregular rotating polygon with dark edge + highlight.
   * Fragments bounce off walls and are absorbed by the portal when it exists.
   */
  spawnDeathParticles(x, y, color, count) {
    const CAP = 300;
    const { dark, bright } = this._fragColorVariants(color);

    for (let i = 0; i < count; i++) {
      if (this._soulDebris.length >= CAP) this._soulDebris.shift();

      const angle  = (i / count) * Math.PI * 2 + Math.random() * 0.85;
      const speed  = 70 + Math.random() * 170;
      const life   = 8.0;  // seconds; decrements each frame, portal sets to 0 early
      const nSides = 3 + Math.floor(Math.random() * 3);   // 3–5 sides
      const baseR  = 3.5 + Math.random() * 5.5;           // radius 3.5–9 px

      // Build an irregular convex-ish polygon in local space
      const pts = [];
      for (let j = 0; j < nSides; j++) {
        const a = (j / nSides) * Math.PI * 2
                + (Math.random() - 0.5) * (Math.PI / nSides) * 0.7;
        const r = baseR * (0.55 + Math.random() * 0.50);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }

      this._soulDebris.push({
        x:      x + (Math.random() - 0.5) * 12,
        y:      y + (Math.random() - 0.5) * 12,
        vx:     Math.cos(angle) * speed,
        vy:     Math.sin(angle) * speed,
        angle:  Math.random() * Math.PI * 2,
        spin:   (Math.random() - 0.5) * 14,   // rad/s
        pts,
        radius: baseR,
        color,
        dark,
        bright,
        life,   // stays at 1 forever; portal sets to 0 on absorption
      });
    }
  }

  /** Parse #rrggbb and return darker edge + brighter highlight variants. */
  _fragColorVariants(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const dark   = `rgb(${Math.floor(r * 0.28)},${Math.floor(g * 0.28)},${Math.floor(b * 0.28)})`;
    const bright = `rgb(${Math.min(255, r + 90)},${Math.min(255, g + 90)},${Math.min(255, b + 90)})`;
    return { dark, bright };
  }

  _updateSoulDebris(dt) {
    const velFric  = Math.pow(0.32, dt);   // velocity friction
    const spinFric = Math.pow(0.88, dt);   // spin decays more slowly

    for (const d of this._soulDebris) {
      // Rotate
      d.spin  *= spinFric;
      d.angle += d.spin * dt;

      // Axis-separated wall bounce
      const nx = d.x + d.vx * dt;
      const ny = d.y + d.vy * dt;
      const bx = this._fragBlocked(nx, d.y);
      const by = this._fragBlocked(d.x, ny);

      if (!bx) {
        d.x = nx;
      } else {
        d.vx = -d.vx * 0.38;
        d.spin += (Math.random() - 0.5) * 4;  // randomise spin on bounce
      }
      if (!by) {
        d.y = ny;
      } else {
        d.vy = -d.vy * 0.38;
        d.spin += (Math.random() - 0.5) * 4;
      }

      d.vx *= velFric;
      d.vy *= velFric;
      d.life -= dt;
    }
    this._soulDebris = this._soulDebris.filter(d => d.life > 0);
  }

  /** Returns true if world point (x, y) is inside a wall tile. */
  _fragBlocked(x, y) {
    if (!this.map || !this.tileSize) return false;
    const ts  = this.tileSize;
    const col = Math.floor(x / ts);
    const row = Math.floor(y / ts);
    if (row < 0 || row >= this.map.length || col < 0 || col >= this.map[0].length) return true;
    return this.map[row][col] === 1 || this.map[row][col] === 2;
  }

  _drawSoulDebris(ctx) {
    for (const d of this._soulDebris) {
      const alpha = 0.94 * Math.min(1, d.life / 2.0);  // fade out over last 2 seconds

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);

      const pts = d.pts;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.closePath();

      // Base fill — enemy colour
      ctx.fillStyle = d.color;
      ctx.fill();

      // Dark edge outline — gives the chunk visual weight
      ctx.strokeStyle = d.dark;
      ctx.lineWidth   = 1.1;
      ctx.stroke();

      // Bright highlight on the first edge — simulates a single light source
      ctx.strokeStyle  = d.bright;
      ctx.lineWidth    = 0.85;
      ctx.globalAlpha  = alpha * 0.65;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.stroke();

      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
