import { getConfig } from "./lib/config";
import { GitHub } from "./lib/github";

async function main(): Promise<void> {
  const config = await getConfig();
  const github = new GitHub(config.githubToken);

  const repo = await github.getRepository("git-test", "ukayani");
  console.log(repo.git.organization);
}

main().catch(console.error);
