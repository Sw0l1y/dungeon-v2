export class SceneManager {
  constructor(game) {
    this.game = game;
    this._stack = [];
  }

  get current() {
    return this._stack[this._stack.length - 1] ?? null;
  }

  /** Replace the entire stack with one scene. */
  switch(scene) {
    while (this._stack.length) this._stack.pop()?.onExit();
    this._stack.push(scene);
    scene.onEnter();
  }

  /** Overlay a scene on top (e.g. pause menu over gameplay). */
  push(scene) {
    this.current?.onPause?.();
    this._stack.push(scene);
    scene.onEnter();
  }

  /** Remove the top scene and resume the one beneath. */
  pop() {
    this._stack.pop()?.onExit();
    this.current?.onResume?.();
  }

  update(dt) {
    this.current?.update(dt);
  }

  draw(ctx) {
    for (const scene of this._stack) scene.draw(ctx);
  }
}
