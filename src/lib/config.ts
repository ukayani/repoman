/**
 * @fileoverview Configuration class.
 */

import * as fs from "fs";
import { promisify } from "util";
const readFile = promisify(fs.readFile);
import * as yaml from "js-yaml";
import * as path from "path";
import * as os from "os";
import { RepoID } from "./github";
const writeFile = promisify(fs.writeFile);

const cache = new Map<string, Config>();

export async function getConfig(configFilename?: string): Promise<Config> {
  let filename: string;
  if (configFilename) {
    filename = configFilename;
  } else if (process.env.REPO_CONFIG_PATH) {
    filename = process.env.REPO_CONFIG_PATH;
  } else {
    filename = "./config.yaml";
  }

  const cached = cache.get(filename);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const yamlContent = await readFile(filename, { encoding: "utf8" });
    const config = yaml.safeLoad(yamlContent) as Config;
    cache.set(filename, config);
    config.clonePath = config.clonePath || path.join(os.homedir(), ".repo");
    return config;
  } catch (err) {
    console.error(
      `Cannot read configuration file ${filename}. Have you created it? Use config.yaml.default as a sample.`
    );
    throw new Error("Configuration file is not found");
  }
}

export async function saveRepoList(
  list: RepoID[],
  path?: string
): Promise<void> {
  const finalPath = path || `./repos.yaml`;

  const content = Buffer.from(yaml.safeDump({ repos: list }, {}));
  await writeFile(finalPath, content);
}

export async function loadRepoList(path?: string): Promise<RepoID[]> {
  const finalPath = path || `./repos.yaml`;

  const yamlContent = await readFile(finalPath, { encoding: "utf8" });
  const { repos } = yaml.safeLoad(yamlContent) as { repos: RepoID[] };

  return repos;
}

export interface Config {
  githubToken: string;
  clonePath: string;
  repos?: [
    {
      org: string;
      regex?: string;
      name?: string;
    }
  ];
}
