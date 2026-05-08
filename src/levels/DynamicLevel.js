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

    // Custom tile colors (falls back to default dark palette)
    this.tileColors = {
      floor:        config.tileColors?.floor        ?? '#22304a',
      wall:         config.tileColors?.wall         ?? '#1a2340',
      destructible: config.tileColors?.destructible ?? '#1a2340',
    };

    // Per-room wave config — null means WaveManager uses its hardcoded formula
    this.waveConfig = config.waves ?? null;
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
    const { floor, wall, destructible } = this.tileColors;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = this.map[r][c];
        const x = c * ts, y = r * ts;

        if (tile === 0) {
          ctx.fillStyle = floor;
          ctx.fillRect(x, y, ts, ts);
        } else if (tile === 1) {
          // Permanent wall — solid fill + rim border
          ctx.fillStyle = wall;
          ctx.fillRect(x, y, ts, ts);
          ctx.strokeStyle = 'rgba(91,195,255,0.10)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(x, y, ts, ts);
        } else if (tile === 2) {
          // Destructible wall — custom color + dashed inner rect to stay visually distinct
          ctx.fillStyle = destructible;
          ctx.fillRect(x, y, ts, ts);
          ctx.strokeStyle = 'rgba(91,195,255,0.10)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(x, y, ts, ts);
          ctx.strokeStyle = 'rgba(91,195,255,0.32)';
          ctx.lineWidth   = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x + 4, y + 4, ts - 8, ts - 8);
          ctx.setLineDash([]);
        } else if (tile === 3) {
          // No-spawn floor — passable, enemies cannot spawn here
          ctx.fillStyle = floor;
          ctx.fillRect(x, y, ts, ts);
          ctx.fillStyle = 'rgba(255,60,60,0.18)';
          ctx.fillRect(x, y, ts, ts);
          ctx.strokeStyle = 'rgba(255,80,80,0.30)';
          ctx.lineWidth   = 1;
          ctx.setLineDash([2, 3]);
          ctx.strokeRect(x + 1, y + 1, ts - 2, ts - 2);
          ctx.setLineDash([]);
        }
      }
    }

    this._drawDebris(ctx);
    this._drawSoulDebris(ctx);
    super.draw(ctx);
  }
}
