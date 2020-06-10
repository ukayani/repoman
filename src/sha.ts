import * as crypto from "crypto";

export function blobSha(content: Buffer): string {
  const header = `blob ${content.length}\0`;
  const shasum = crypto.createHash("sha1");
  shasum.update(Buffer.concat([Buffer.from(header), content]));
  return shasum.digest("hex");
}
