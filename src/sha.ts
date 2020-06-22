import * as crypto from "crypto";

export function blobSha(content: Buffer): string {
  return gitSha("blob", content);
}

export function gitSha(type: string, content: Buffer): string {
  const header = `${type} ${content.length}\0`;
  const shasum = crypto.createHash("sha1");
  shasum.update(Buffer.concat([Buffer.from(header), content]));
  return shasum.digest("hex");
}
