import { GitHub, Config } from "../src";

async function main() {
  const github = await GitHub.init();
  const repo = await github.getRepository("git-test", "ukayani");
  console.log(repo.toString());
}

main().catch(console.error);
