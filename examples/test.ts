import { Config, FS, GitHub } from "../src";

async function main() {
  const github = await GitHub.init();
  // const searches = await github.searchCode("");
  const config = await Config.load("services.yaml");
  const mvn = await FS.getFile(".mvn");
  const mvnw = await FS.getFile("mvnw");
  const mvnwcmd = await FS.getFile("mvnw.cmd");
  const repos = await github.getRepositories(config.repos);

  for (const repo of repos) {
    const stage = await repo.checkout("maven-wrapper").stage();
    const result = await stage
      .addLocalFiles(mvn)
      .addLocalFiles(mvnw)
      .addLocalFiles(mvnwcmd)
      .dryRun(true)
      .commit("Updating to latest maven");
    console.log(result);
    //console.log(result.changelog());
  }
  // for (const repo of repos) {
  //   console.log(repo.name);
  // }
  //
  // for (const s of searches) {
  //   console.log(s);
  // }
  // const repo = await github.getRepository("git-test", "ukayani");
  // const commit = await repo.git.getLatestCommitToBranch("master");
  // console.log(commit);
  // // const stage = await repo.checkout("dry-run-test3", "master").stage();
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
