import { Config, FS, GitHub } from "../src";

async function main() {
  const github = await GitHub.init();
  const config = await Config.load("services.yaml");
  const mvn = await FS.getFile(".mvn");
  const mvnw = await FS.getFile("mvnw");
  const mvnwcmd = await FS.getFile("mvnw.cmd");
  const repos = await github.getRepositories(config.repos);

  for (const repo of repos) {
    const result = await repo
      .checkout("maven-wrapper-test")
      .addLocalFiles(mvn)
      .addLocalFiles(mvnw)
      .addLocalFiles(mvnwcmd)
      .commit("Updating to latest maven");
    console.log(result.changelog());
  }
}

main().catch(console.error);
