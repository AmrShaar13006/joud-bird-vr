// 32-bit FNV-1a. Numbers are hashed through their exact Float64 bits, so two runs
// hash the same only if every simulated double is bit-for-bit identical.

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

export class Fnv {
  private h = OFFSET;
  private readonly view = new DataView(new ArrayBuffer(8));

  reset(): this {
    this.h = OFFSET;
    return this;
  }

  private byte(b: number): void {
    this.h = Math.imul(this.h ^ b, PRIME) >>> 0;
  }

  /** Little-endian Float64 bits of `v`. */
  f64(v: number): this {
    this.view.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.byte(this.view.getUint8(i));
    return this;
  }

  /** UTF-16 code units, low byte first. */
  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c & 0xff);
      this.byte(c >>> 8);
    }
    return this;
  }

  get value(): number {
    return this.h;
  }

  /** 8 lowercase hex digits. */
  hex(): string {
    return toHex(this.h);
  }
}

export function toHex(u32: number): string {
  return (u32 >>> 0).toString(16).padStart(8, '0');
}
