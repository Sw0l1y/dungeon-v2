/** Base class for all scenes. Override the methods you need. */
export class Scene {
  constructor(game) {
    this.game = game;
  }

  onEnter() {}
  onExit() {}
  onPause() {}
  onResume() {}

  update(_dt) {}
  draw(_ctx) {}
}
