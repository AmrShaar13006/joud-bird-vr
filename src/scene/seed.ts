// Round seeds for the shells. The core never reads randomness itself: the shell
// makes a uint32 here and passes it in (step 2 will ask the server instead on mobile).

/** A fresh uint32 seed from the browser's crypto generator. */
export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}
