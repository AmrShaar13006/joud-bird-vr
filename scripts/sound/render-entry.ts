// Entry for scripts/sound/render-samples.mjs: the game's own voices, limiter and percussion.
import { MASTER_GAIN, makeLimiter } from '../../src/mobile/sound/engine';

export { makeLimiter, playCue } from '../../src/mobile/sound/engine';
export { schedulePreview } from '../../src/mobile/sound/percussion';
export { makeNoise, tick } from '../../src/mobile/sound/voices';

/** The game's master chain (as in SoundEngine.unlock): gain, then the limiter when `limit`. */
export function masterChain(ctx: BaseAudioContext, limit: boolean): GainNode {
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  if (limit) master.connect(makeLimiter(ctx)).connect(ctx.destination);
  else master.connect(ctx.destination);
  return master;
}
