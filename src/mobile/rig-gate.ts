// ?debug=1&rig=1: Joud's rig prototype (rig-view.ts, its own lazy chunk) replaces the game.
// main.ts imports this module first. On the rig page it starts the rig view and then throws,
// and an error while a module evaluates stops every module that imports it: main.ts never
// runs there, so no game, no sign-in and no service worker. Everywhere else it is one URL check.
//
// Why a throw and not a never-resolving top-level await: any top-level await in the play/
// entry stops Rollup from treating the game's shared chunk as already loaded, so it splits
// that chunk (and the VR pages' copy of it) in two. The throw keeps the build as it was.
import { parseUrl } from '../core/config';

if (parseUrl(window.location.search).flags.debug && new URLSearchParams(window.location.search).get('rig') === '1') {
  void import('./rig-view').then((m) => m.startRigView());
  throw new Error('[rig] ?rig=1: rig prototype page, the game is not started (expected)');
}
