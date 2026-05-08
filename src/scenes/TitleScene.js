import { Scene            } from './Scene.js';
import { OnlineWaitScene } from './OnlineWaitScene.js';

export class TitleScene extends Scene {
  onEnter() {
    this._pressedStart = false;
  }

  update(_dt) {
    if (this.game.input.justPressed('Enter') || this.game.input.justPressed('Space')) {
      this.game.scenes.switch(new OnlineWaitScene(this.game));
    }
  }

  draw(ctx) {
    const { width, height } = this.game.canvas;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#8cf3ff';
    ctx.font = 'bold 64px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DUNGEON V2', width / 2, height / 2 - 48);

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '24px "Trebuchet MS", sans-serif';
    ctx.fillText('Press ENTER or SPACE to start', width / 2, height / 2 + 32);
  }
}
