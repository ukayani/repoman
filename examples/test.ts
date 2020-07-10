import { GitHub } from "../src";

async function main() {
  const github = await GitHub.init();
  // const searches = await github.searchCode("");
  //
  // for (const s of searches) {
  //   console.log(s);
  // }
  const repo = await github.getRepository("git-test", "ukayani");
  const commit = await repo.git.getLatestCommitToBranch("master");
  console.log(commit);
  // const stage = await repo.checkout("dry-run-test3", "master").stage();
  //
  // const ref = await stage
  //   .addFile("bumper2.txt", "Testing HEllo2\n")
  //   .deleteFile("bumper.txt")
  //   .moveFile("exc/test.sh", "exc/testing.sh")
  //   .dryRun(false)
  //   .commit("add check");
  //
  // console.log(ref);
  // console.log(repo.name);
}

main().catch(console.error);
