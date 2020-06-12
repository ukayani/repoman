import * as assert from "assert";
import { describe, it } from "mocha";
import { blobSha } from "../src/sha";

describe("git sha", () => {
  it("should generate correctly for simple utf-8 string", () => {
    const sha = blobSha(Buffer.from("what is up, doc?"));
    assert.equal(sha, "bd9dbf5aae1a3862dd1526723246b20206e5fc37");
  });
});
