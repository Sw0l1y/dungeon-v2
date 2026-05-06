import { Enemy } from '../entities/Enemy.js';

export class WaveManager {
  constructor(level) {
    this.level    = level;
    this.wave     = 0;
    this.active   = false;
    this._enemies = [];
    this._spawnCache = null;
  }

  get remaining() { return this._enemies.filter(e => e.alive).length; }

  startWave() {
    if (this.active) return;
    this.wave++;
    this.active   = true;
    this._enemies = [];

    const count = 3 + this.wave * 2;
    const spots  = this._spawnSpots();

    for (let i = 0; i < count; i++) {
      const { x, y } = spots[Math.floor(Math.random() * spots.length)];
      const e = new Enemy(this.level, x, y);
      this.level.addEntity(e);
      this._enemies.push(e);
    }
  }

  update() {
    if (!this.active) return;
    this._enemies = this._enemies.filter(e => e.alive);
    if (this._enemies.length === 0) this.active = false;
  }

  // Collect valid floor tiles in the outer 35% of the map, cached after first call.
  _spawnSpots() {
    if (this._spawnCache) return this._spawnCache;
    const { map, tileSize: ts } = this.level;
    const rows = map.length;
    const cols = map[0].length;
    const spots = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (map[r][c] !== 0) continue;
        const rx = c / cols;
        const ry = r / rows;
        if (rx < 0.35 || rx > 0.65 || ry < 0.35 || ry > 0.65) {
          spots.push({ x: (c + 0.5) * ts, y: (r + 0.5) * ts });
        }
      }
    }
    this._spawnCache = spots.length ? spots : [{ x: 5 * ts, y: 5 * ts }];
    return this._spawnCache;
  }
}
