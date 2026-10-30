// iPhone photos in HEIC/HEIF, which sharp's bundled libvips can't decode: libheif (compiled to WebAssembly, loaded only when a
// HEIC comes in) gives the main image's pixels, already turned the right way up. A file may hold several images (a burst, a
// Live Photo's still): the primary one is what the photo is. Decoding holds the picture several times over, so a photo over
// MAX_PIXELS is refused before it is decoded; freundebuch runs in little memory.
import { InvalidInputError } from "./errors";

/** About a 24 MP iPhone photo; a 48 MP "HEIF Max" one would need several hundred MB to decode. */
export const MAX_PIXELS = 25_000_000;
export const TOO_LARGE = "This photo is too large (over 25 megapixels): share a smaller one, or a screenshot of it";

type HeifImage = {
  free(): void;
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (d: { data: Uint8ClampedArray } | null) => void): void;
};
type Libheif = { ready?: Promise<unknown>; HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[]; decoder: { delete(): void } } };

/** The primary image of a HEIC as RGBA; InvalidInputError when it is over MAX_PIXELS, an Error when it can't be decoded. */
export async function decodeHeic(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const mod = (await import("libheif-js/wasm-bundle.js")) as { default?: Libheif } & Libheif;
  const libheif = mod.default ?? mod;
  await libheif.ready;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(bytes);
  try {
    const image = images.find((i) => i.is_primary()) ?? images[0];
    if (!image) throw new Error("no image in the HEIF");
    const [width, height] = [image.get_width(), image.get_height()];
    if (width * height > MAX_PIXELS) throw new InvalidInputError(TOO_LARGE);
    const rgba = await new Promise<Uint8ClampedArray>((resolve, reject) =>
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (d) =>
        d ? resolve(d.data) : reject(new Error("HEIF processing error")),
      ),
    );
    return { width, height, rgba };
  } finally {
    for (const i of images) i.free();
    decoder.decoder.delete();
  }
}
