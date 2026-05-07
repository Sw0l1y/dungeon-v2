import { Game } from './Game.js';

const VIRT_W = 1120;
const VIRT_H = 630;

const canvas = document.getElementById('canvas');

// Proxy: all game code reads virtual dimensions (1120×630).
// The real canvas buffer is sized to physical pixels (CSS size × devicePixelRatio)
// so the image stays sharp at any display scale or fullscreen size.
const vCanvas = new Proxy(canvas, {
  get(target, prop) {
    if (prop === 'width')  return VIRT_W;
    if (prop === 'height') return VIRT_H;
    const val = Reflect.get(target, prop);
    return typeof val === 'function' ? val.bind(target) : val;
  },
});

function syncBuffer() {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const pw = Math.round(rect.width  * dpr) || VIRT_W;
  const ph = Math.round(rect.height * dpr) || VIRT_H;
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width  = pw;
    canvas.height = ph;
  }
  canvas.__sx = pw / VIRT_W;
  canvas.__sy = ph / VIRT_H;
}

new ResizeObserver(syncBuffer).observe(canvas);
syncBuffer();

const game = new Game(vCanvas);
game.start();
window.__game = game; // dev handle
