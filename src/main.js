import { Game } from './Game.js';

const canvas = document.getElementById('canvas');
canvas.width = 1120;
canvas.height = 630;

const game = new Game(canvas);
game.start();
window.__game = game; // dev handle
