import { Level  } from './Level.js';
import { Player } from '../entities/Player.js';

const DEFAULT_TILE = 40;

/**
 * A level built from a room-config object loaded from maps.json.
 * Drop-in replacement for Level1 — same interface, dynamic data.
 */
export class DynamicLevel extends Level {
  constructor(game, config) {
    super(game, config.name ?? 'Room');

    // Deep-copy tiles so wall destruction mutates our copy only
    this.map       = config.tiles.map(row => [...row]);
    this.tileSize  = config.tileSize  ?? DEFAULT_TILE;
    this.worldWidth  = (config.cols ?? this.map[0].length) * this.tileSize;
    this.worldHeight = (config.rows ?? this.map.length)    * this.tileSize;

    // Player spawn point (tile coords → world centre of that tile)
    const ts = this.tileSize;
    this._spawnX = ((config.playerSpawn?.col ?? Math.floor(this.map[0].length / 2)) + 0.5) * ts;
    this._spawnY = ((config.playerSpawn?.row ?? Math.floor(this.map.length    / 2)) + 0.5) * ts;
  }

  onEnter() {
    const configs = this.game.state.players ?? [
      { name: 'Player 1', color: '#8cf3ff', binding: this.game.bindings.player1 },
    ];
    const cx = this._spawnX;
    const cy = this._spawnY;

    const OFFSETS  = [[0, 0], [-14, 0], [14, 0]];
    const OFFSETS4 = [[-21, -14], [21, -14], [-21, 14], [21, 14]];
    const n = configs.length;

    configs.forEach((cfg, i) => {
      const [ox, oy] = n >= 3
        ? (OFFSETS4[i] ?? [0, 0])
        : (OFFSETS[n === 1 ? 0 : i + 1] ?? [0, 0]);
      this.addPlayer(new Player(
        this.game, this,
        cx + ox, cy + oy,
        cfg.binding, cfg.name, cfg.color, cfg.classId ?? 'sword',
      ));
    });
  }

  onExit() {
    this.entities = [];
    this.players  = [];
    this.player   = null;
  }

  draw(ctx) {
    const ts   = this.tileSize;
    const rows = this.map.length;
    const cols = this.map[0].length;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = this.map[r][c];
        if (tile === 0) {
          ctx.fillStyle = '#22304a';
          ctx.fillRect(c * ts, r * ts, ts, ts);
        } else {
          // Both perm-wall (1) and destructible (2) share the same appearance in-game
          ctx.fillStyle = '#1a2340';
          ctx.fillRect(c * ts, r * ts, ts, ts);
          ctx.strokeStyle = 'rgba(91,195,255,0.08)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(c * ts, r * ts, ts, ts);
        }
      }
    }

    this._drawDebris(ctx);
    this._drawSoulDebris(ctx);
    super.draw(ctx);
  }
}
