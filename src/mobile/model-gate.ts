// ?debug=1&rig=1&model=v2: Joud's v2 model (public/models/joud-v2.glb) in a viewer that
// replaces the game. main.ts imports this module first. On the viewer page it starts the
// viewer (its own lazy chunk) and then throws: an error while a module evaluates stops every
// module that imports it, so main.ts never runs there (no game, no sign-in, no service
// worker). Everywhere else it is one URL check.
//
// Why a throw and not a never-resolving top-level await: any top-level await in the play/
// entry stops Rollup from treating the game's shared chunk as already loaded, so it splits
// that chunk (and the VR pages' copy of it) in two. The throw keeps the build as it was.
//
// The viewer draws the game's own backdrop (&bg=game) with game-backdrop.ts. That module is in the
// play/ entry's chunk, which the throw leaves in an error state, so the viewer's chunk cannot
// import it: it is imported here, where it has already run, and handed to startModelView().
import { parseUrl } from '../core/config';
import * as gameBackdrop from './game-backdrop';

const q = new URLSearchParams(window.location.search);
if (parseUrl(window.location.search).flags.debug && q.get('rig') === '1' && /^v[12]$/.test(q.get('model') ?? '')) {
  void import('./model-view').then((m) => m.startModelView(gameBackdrop));
  throw new Error('[model] ?rig=1&model=v1|v2: Joud model viewer, the game is not started (expected)');
}
