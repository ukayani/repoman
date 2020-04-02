import { getConfig } from "./lib/config";
import { GitHub } from "./lib/github";

async function main(): Promise<void> {
  const config = await getConfig();
  const github = new GitHub(config.githubToken);

  const repo = await github.getRepository("git-test", "ukayani");
  const stage = await repo.checkout("testing-modify", "master").stage();
  const ref = stage
    .modifyFiles("*.txt", async (path, content, mode) => {
      console.log(path);
      const text = content.toString("utf8");
      const newContent = Buffer.from(text + "\n.modified", "utf8");
      return { content: newContent, mode: mode };
    })
    .commit("modifying txts");

  console.log(ref);
  console.log(repo.git.organization);
}

main().catch(console.error);
