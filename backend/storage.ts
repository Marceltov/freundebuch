// Where the shared screenshots live: files under DATA_DIR (the default) or an S3-compatible bucket (FREUNDEBUCH_STORAGE=s3).
// Keys are relative paths such as `screenshots/<id>.webp`. The bucket stays private: images reach a browser only through
// freundebuch, after the visibility check (files.ts), never by a direct or presigned link.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { AwsClient } from "aws4fetch";
import { config, type S3Config } from "./config";

export interface BlobStore {
  put(key: string, bytes: Uint8Array, type: string): Promise<void>;
  /** null when there is no blob under `key`. */
  get(key: string): Promise<Uint8Array | null>;
  /** Deleting a missing blob is not an error. */
  delete(key: string): Promise<void>;
}

export function fileStore(dir: string): BlobStore {
  const root = resolve(dir);
  const path = (key: string) => {
    const p = resolve(root, key);
    if (!p.startsWith(root + sep)) throw new Error(`storage key outside the store: ${key}`);
    return p;
  };
  return {
    async put(key, bytes) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, bytes);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(path(key)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async delete(key) {
      await rm(path(key), { force: true });
    },
  };
}

export function s3Store(o: Omit<S3Config, "kind">, fetchFn: typeof fetch = fetch): BlobStore {
  const aws = new AwsClient({ accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, region: o.region, service: "s3", retries: 0 });
  const base = new URL(o.endpoint);
  const url = (key: string) => {
    const k = key.split("/").map(encodeURIComponent).join("/");
    return o.pathStyle ? `${base.origin}/${o.bucket}/${k}` : `${base.protocol}//${o.bucket}.${base.host}/${k}`;
  };
  const send = async (method: string, key: string, init: { body?: Uint8Array; type?: string } = {}) => {
    const req = await aws.sign(url(key), { method, body: init.body as BodyInit | undefined, headers: init.type ? { "content-type": init.type } : {} });
    return fetchFn(req);
  };
  // The bucket's error body can name the bucket and key, nothing personal; only the status goes into the error.
  const fail = (what: string, res: Response) => new Error(`S3 ${what} failed with status ${res.status}`);
  return {
    async put(key, bytes, type) {
      const res = await send("PUT", key, { body: bytes, type });
      if (!res.ok) throw fail("put", res);
    },
    async get(key) {
      const res = await send("GET", key);
      if (res.status === 404) return null;
      if (!res.ok) throw fail("get", res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await send("DELETE", key);
      if (!res.ok && res.status !== 404) throw fail("delete", res);
    },
  };
}

/** The configured store. */
export function store(): BlobStore {
  const c = config.storage();
  return c.kind === "s3" ? s3Store(c) : fileStore(config.dataDir());
}
