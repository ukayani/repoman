import { GitHub, ObjectPredicates } from "../src";

async function main() {
  const github = await GitHub.init();
  const repo = await github.getRepository("git-test", "ukayani");
  const stage = await repo.checkout("dry-run-test", "master").stage();

  const ref = await stage
    .modifyFiles(
      ObjectPredicates.pathEquals("bump.txt"),
      async (_, content, mode) => {
        const contentString = content.toString("utf8");
        return {
          content: Buffer.from("testing22\ntest:::" + contentString),
          mode,
        };
      }
    )
    .addFile("bumper2.txt", "Testing HEllo2\n")
    .deleteFile("bumper.txt")
    .moveFile("exc/test.sh", "exc/testing.sh")
    .commit("add check");

  console.log(ref);
}

main().catch(console.error);
