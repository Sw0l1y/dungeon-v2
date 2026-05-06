export class Camera {
  constructor(viewWidth, viewHeight) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.x = 0;
    this.y = 0;
    this.smoothing = 6; // higher = snappier follow
  }

  /** Smoothly follow a world-space point. Call each frame before drawing. */
  follow(targetX, targetY, dt) {
    const t = 1 - Math.exp(-this.smoothing * dt);
    this.x += (targetX - this.viewWidth / 2 - this.x) * t;
    this.y += (targetY - this.viewHeight / 2 - this.y) * t;
  }

  /** Snap the camera instantly to center on a point. */
  snapTo(worldX, worldY) {
    this.x = worldX - this.viewWidth / 2;
    this.y = worldY - this.viewHeight / 2;
  }

  /** Clamp the camera so it doesn't show outside the world bounds. */
  clamp(worldWidth, worldHeight) {
    this.x = Math.max(0, Math.min(this.x, Math.max(0, worldWidth  - this.viewWidth)));
    this.y = Math.max(0, Math.min(this.y, Math.max(0, worldHeight - this.viewHeight)));
  }

  /** Apply the camera transform to a ctx before drawing the world. */
  applyTransform(ctx) {
    ctx.translate(-Math.round(this.x), -Math.round(this.y));
  }

  /** Convert screen coords to world coords (e.g. for mouse picking). */
  screenToWorld(sx, sy) {
    return { x: sx + this.x, y: sy + this.y };
  }
}
