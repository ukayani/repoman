import { GitHub, Config, Writers, FS } from "../src";

async function main() {
  const github = await GitHub.init();
  const repo = await github.getRepository("git-test", "ukayanis");
  await repo.git.fetchBranch("master", "./hello-world");

  console.log(repo.toString());
}

main().catch(console.error);
