import { GitHub } from "../src";

async function main() {
  const github = await GitHub.init();
  const repo = await github.getRepository("git-test", "ukayani");
  const stage = await repo.checkout("dry-run-test", "master").stage();

  const ref = await stage
    .modifyFile("bump.txt", async (content) => {
      return "testing2::" + content;
    })
    .addFile("bumper2.txt", "Testing HEllo2\n")
    .deleteFile("bumper.txt")
    .moveFile("exc/test.sh", "exc/testing.sh")
    .dryRun()
    .commit("add check");

  console.log(ref);
}

main().catch(console.error);
