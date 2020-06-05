import { GitHub, ObjectPredicates } from "../src";

async function main() {
  const github = await GitHub.init();
  const repo = await github.getRepository("git-test", "ukayani");
  const stage = await repo.checkout("dry-run-test", "master").stage();

  const ref = await stage
    .modifyFiles(
      ObjectPredicates.pathEquals("bump.txt"),
      async (path, content, mode) => {
        const contentString = content.toString("utf8");
        return {
          content: Buffer.from("testing:::" + contentString),
          mode,
        };
      }
    )
    .commit("modify check");

  console.log(ref);
}

main().catch(console.error);
