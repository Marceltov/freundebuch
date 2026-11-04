import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { config } from "../core/config";

test("a test that sets no DATA_DIR keeps its data in a temporary directory, never /data", () => {
  expect(config.dataDir()).not.toBe("/data");
  expect(config.dataDir().startsWith(tmpdir())).toBe(true);
});
