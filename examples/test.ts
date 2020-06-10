import { GitHub } from "../src";
import { blobSha } from "../src/sha";

async function main() {
  const github = await GitHub.init();
  const repo = await github.getRepository("git-test", "ukayani");
  const stage = await repo.checkout("dry-run-test3", "master").stage();

  const ref = await stage
    .addFile("bumper2.txt", "Testing HEllo2\n")
    .deleteFile("bumper.txt")
    .moveFile("exc/test.sh", "exc/testing.sh")
    .dryRun(false)
    .commit("add check");

  console.log(ref);
  console.log(repo.name);
  console.log(blobSha(Buffer.from("what is up, doc?")));
}

main().catch(console.error);
