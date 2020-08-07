import { Config, GitHub } from "../src";

async function main() {
  const github = await GitHub.init();
  const config = await Config.load("services.yaml");
  const repos = await github.getRepositories(config.repos);
  const automerge = false;

  for (const repo of repos) {
    const result = await repo
      .checkout("maven-wrapper-removal")
      .deleteFile(".mvn")
      .deleteFile("mvnw")
      .deleteFile("mvnw.cmd")
      .commit("Remove maven wrapper");
    console.log(`Changes for ${repo.name}`);
    console.log(result.changelog());

    if (result.hasChanges()) {
      const pr = await repo.createPullRequest(
        result.branch,
        "PR Title",
        "body",
        ["ukayani"]
      );
      if (automerge) {
        await repo.mergePullRequest(pr);
      }
      console.log(pr);
    }
  }
}

main().catch(console.error);
