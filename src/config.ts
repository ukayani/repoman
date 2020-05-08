/**
 * @fileoverview Configuration class.
 */

import * as fs from "fs";
import { promisify } from "util";
import * as yaml from "js-yaml";
import { error } from "./logger";
import { RepoID } from "./github";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

export class Config {
  readonly #token: string;
  readonly #repos: RepoID[];

  constructor(token: string, repos: RepoID[]) {
    this.#token = token;
    this.#repos = repos;
  }

  static async load(configFilename?: string): Promise<Config> {
    const token = process.env.GITHUB_TOKEN;
    let filename: string;

    if (configFilename) {
      filename = configFilename;
    } else if (process.env.GITHUB_CONFIG_PATH) {
      filename = process.env.GITHUB_CONFIG_PATH;
    } else {
      filename = "./config.yaml";
    }

    try {
      const yamlContent = await readFile(filename, { encoding: "utf8" });
      const config = yaml.safeLoad(yamlContent) as ConfigFile;

      return new Config(
        token || config.githubToken!,
        toRepoList(config.orgs || [])
      );
    } catch (err) {
      if (token) {
        return new Config(token, []);
      }
      error(
        `Could not initialize config. No Github Token present via GITHUB_TOKEN or config. If using a config file, ensure it exists.`
      );
      throw new Error("Configuration not found");
    }
  }

  static async save(repos: RepoID[], configFilename?: string): Promise<void> {
    let filename: string;

    if (configFilename) {
      filename = configFilename;
    } else if (process.env.GITHUB_CONFIG_PATH) {
      filename = process.env.GITHUB_CONFIG_PATH;
    } else {
      filename = "./config.yaml";
    }

    const organizations = toOrgList(repos);
    await writeFile(
      filename,
      yaml.safeDump({ orgs: organizations } as ConfigFile)
    );
  }

  get token(): string {
    return this.#token;
  }

  get repos(): RepoID[] {
    return this.#repos;
  }
}

function toRepoList(orgs: Organization[]): RepoID[] {
  return orgs
    .map((o) => o.repos.map((r) => ({ name: r, org: o.name } as RepoID)))
    .reduce((acc, v) => acc.concat(v), []);
}

function toOrgList(repos: RepoID[]): Organization[] {
  const repoMap = repos.reduce((map, repo) => {
    const currentRepos = map.get(repo.org) || [];
    map.set(repo.org, currentRepos.concat(repo.name));
    return map;
  }, new Map<string, string[]>());

  const orgs = [] as Organization[];
  repoMap.forEach((repos, org) => orgs.push({ name: org, repos }));
  return orgs;
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

interface ConfigFile {
  githubToken?: string;
  orgs?: Organization[];
}

interface Organization {
  name: string;
  repos: string[];
}
