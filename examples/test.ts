import { GitHub, Config, Writers, FS } from "../src";

async function main() {
  const github = await GitHub.init();
  const repo = await github.getRepository("git-test", "ukayani");
  const stage = await repo.checkout("testing-branch", "master").stage();
  const files = await FS.getFile("./examples");
  await stage.addLocalFiles(files).commit("testing");
  console.log(repo.toString());
}

main().catch(console.error);
