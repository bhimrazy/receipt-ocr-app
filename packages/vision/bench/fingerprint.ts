import type { Scene } from "./scene";

/** FNV-1a over 32-bit words; folds `data` into `hash`. */
function fold(hash: number, data: ArrayLike<number>): number {
  let h = hash;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i]!, 16777619);
  return h;
}

/** A hash of a scene's pixels and ground truth, to detect that a generator change altered the scenes. */
export function fingerprintScene(scene: Scene, into = 2166136261): number {
  const { pixels, truth } = scene;
  const words = new Uint32Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.length / 4);
  let h = fold(into, words);
  h = fold(h, truth.paper);
  h = fold(h, truth.print);
  h = fold(
    h,
    truth.quad.flatMap((p) => [Math.round(p.x * 1e6), Math.round(p.y * 1e6)]),
  );
  return h >>> 0;
}

export const hex = (h: number) => (h >>> 0).toString(16).padStart(8, "0");
