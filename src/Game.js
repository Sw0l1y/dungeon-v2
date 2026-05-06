import { SceneManager } from './SceneManager.js';
import { Input } from './systems/Input.js';
import { InputBinding } from './systems/InputBinding.js';
import { BINDINGS } from './systems/bindings.js';
import { TitleScene } from './scenes/TitleScene.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Raw key tracker — shared by all bindings, never used directly by game objects
    this.input = new Input();

    // Per-player action bindings — add player2 here when multiplayer is ready
    this.bindings = {
      player1: new InputBinding(this.input, BINDINGS.player1),
      player2: new InputBinding(this.input, BINDINGS.player2),
    };

    this.scenes = new SceneManager(this);
    this.state = {}; // shared bag — scenes write here before transitioning
    this._lastTime = 0;
    this._rafId = null;
  }

  start() {
    this.scenes.push(new TitleScene(this));
    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }

  stop() {
    cancelAnimationFrame(this._rafId);
    this.input.destroy();
  }

  _loop(timestamp) {
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.05); // cap at 50ms
    this._lastTime = timestamp;

    this.scenes.update(dt);
    this.scenes.draw(this.ctx);
    this.input.flush();

    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }
}
