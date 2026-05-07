import { Level } from './Level.js';
import { Player } from '../entities/Player.js';

const TILE = 40;
// 0 = floor, 1 = wall  (30 cols × 17 rows = 1200×680 world)
// 0 = floor, 1 = permanent wall (border), 2 = destructible wall (interior)
const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,1],
  [1,0,0,2,0,0,0,0,0,0,2,2,2,0,0,0,0,2,2,2,0,0,0,0,0,2,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,1],
  [1,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,1],
  [1,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,1],
  [1,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

export class Level1 extends Level {
  constructor(game) {
    super(game, 'Level 1');
    this.map = MAP;
    this.tileSize = TILE;
    this.worldWidth  = MAP[0].length * TILE;
    this.worldHeight = MAP.length    * TILE;
  }

  onEnter() {
    const configs = this.game.state.players ?? [
      { name: 'Player 1', color: '#8cf3ff', binding: this.game.bindings.player1 },
    ];
    // Spawn at map centre so players emerge from the intro portal
    const cx = Math.floor(MAP[0].length / 2) * TILE + TILE / 2;
    const cy = Math.floor(MAP.length    / 2) * TILE + TILE / 2;
    configs.forEach((cfg, i) => {
      const offset = configs.length > 1 ? (i === 0 ? -14 : 14) : 0;
      this.addPlayer(new Player(
        this.game, this,
        cx + offset, cy,
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
    const rows = this.map.length;
    const cols = this.map[0].length;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = this.map[r][c];
        if (tile === 0) {
          ctx.fillStyle = '#22304a';
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        } else if (tile === 1) {
          // Permanent wall
          ctx.fillStyle = '#1a2340';
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
          ctx.strokeStyle = 'rgba(91,195,255,0.08)';
          ctx.lineWidth = 1;
          ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
        } else if (tile === 2) {
          // Destructible wall — same appearance as permanent wall
          ctx.fillStyle = '#1a2340';
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
          ctx.strokeStyle = 'rgba(91,195,255,0.08)';
          ctx.lineWidth = 1;
          ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
        }
      }
    }

    this._drawDebris(ctx);
    this._drawSoulDebris(ctx);
    super.draw(ctx);
  }
}
