// heic-decode ships no types: the main image of a HEIC/HEIF, as RGBA pixels.
declare module "heic-decode" {
  type Decoded = { width: number; height: number; data: Uint8ClampedArray };
  function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<Decoded>;
  export default decode;
}
