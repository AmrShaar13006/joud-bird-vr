/** The only four ways input reaches the core. */
export type GameCommand = 'flap' | 'start' | 'restart' | 'pause';

/**
 * FIFO of commands. Input layers (XR, desktop) push; the game system drains
 * once per frame before stepping the simulation.
 */
export class InputBus {
  private readonly queue: GameCommand[] = [];
  /** Most recent command, for the debug HUD. */
  last: GameCommand | null = null;

  push(cmd: GameCommand): void {
    this.queue.push(cmd);
    this.last = cmd;
  }

  /** Hand every queued command to `fn` in order and empty the queue. */
  drain(fn: (cmd: GameCommand) => void): void {
    for (let i = 0; i < this.queue.length; i++) fn(this.queue[i]);
    this.queue.length = 0;
  }

  get size(): number {
    return this.queue.length;
  }
}
