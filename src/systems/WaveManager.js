import { Enemy    } from '../entities/Enemy.js';
import { Sprinter } from '../entities/Sprinter.js';
import { Ranger   } from '../entities/Ranger.js';
import { Boss     } from '../entities/Boss.js';
import { Pulsar   } from '../entities/Pulsar.js';
import { Relay    } from '../entities/Relay.js';

export class WaveManager {
  constructor(level) {
    this.level        = level;
    this.wave         = 0;
    this.active       = false;
    this.bossDefeated = false;
    this._enemies     = [];
    this._spawnCache  = null;
    this._countdown   = 0;   // seconds until next wave auto-starts
    this._netIdSeq    = 0;   // monotonic counter for enemy net IDs
  }

  get remaining()  { return this._enemies.filter(e => e.alive).length; }
  get countdown()  { return this._countdown; }

  startWave() {
    if (this.active || this.bossDefeated) return;
    this.wave++;
    this.active   = true;
    this._enemies = [];

    // Wave 5 — boss only, spawns at arena center
    if (this.wave === 5) {
      const { map, tileSize: ts } = this.level;
      const cx = Math.floor(map[0].length / 2) * ts + ts / 2;
      const cy = Math.floor(map.length    / 2) * ts + ts / 2;
      const boss = new Boss(this.level, cx, cy);
      boss._netId = ++this._netIdSeq;
      // Give the boss a reference back to this WaveManager so it can set bossDefeated
      this.level.game.state._waveManager = this;
      this.level.addEntity(boss);
      this._enemies.push(boss);
      return;
    }

    const spots     = this._spawnSpots();
    const basics    = 2 + this.wave;
    const sprinters = Math.max(0, this.wave - 1);
    const rangers   = Math.max(0, this.wave - 2);
    const pairs     = this.wave >= 3 ? 1 : 0; // one Pulsar+Relay pair from wave 3

    const spawn = (Type) => {
      const { x, y } = spots[Math.floor(Math.random() * spots.length)];
      const e = new Type(this.level, x, y);
      e._netId = ++this._netIdSeq;
      this.level.addEntity(e);
      this._enemies.push(e);
    };

    const spawnPair = () => {
      const s1 = spots[Math.floor(Math.random() * spots.length)];
      const s2 = spots[Math.floor(Math.random() * spots.length)];
      const relay  = new Relay(this.level, s2.x, s2.y);
      const pulsar = new Pulsar(this.level, s1.x, s1.y, relay);
      relay.pulsar = pulsar;
      relay._netId  = ++this._netIdSeq;
      pulsar._netId = ++this._netIdSeq;
      this.level.addEntity(relay);
      this.level.addEntity(pulsar);
      this._enemies.push(relay);
      this._enemies.push(pulsar);
    };

    for (let i = 0; i < basics;    i++) spawn(Enemy);
    for (let i = 0; i < sprinters; i++) spawn(Sprinter);
    for (let i = 0; i < rangers;   i++) spawn(Ranger);
    for (let i = 0; i < pairs;     i++) spawnPair();
  }

  update(dt) {
    if (this.active) {
      this._enemies = this._enemies.filter(e => e.alive);
      if (this._enemies.length === 0) {
        this.active = false;
        // Start 15s inter-wave countdown (not after boss — that ends the run)
        if (!this.bossDefeated) this._countdown = 15;
      }
      return;
    }

    // Tick down inter-wave countdown
    if (this._countdown > 0 && !this.bossDefeated) {
      this._countdown = Math.max(0, this._countdown - dt);
      if (this._countdown === 0) this.startWave();
    }
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
