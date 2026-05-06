/** Base class for all levels. */
export class Level {
  constructor(game, name) {
    this.game = game;
    this.name = name;
    this.entities = [];
    this.players = []; // all player entities
    this.player  = null; // primary player (first added), kept for compat
  }

  onEnter() {}
  onExit() {}

  update(dt) {
    for (const e of this.entities) e.update?.(dt);
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
}
