import { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { Minimatch } from "minimatch";
import * as p from "path";
import { User } from "../github";
import { Checkout } from "./checkout";

export class Repository {
  #client: AxiosInstance;
  #name: string;
  #owner: User;
  #cloneUrl?: string;
  #sshUrl?: string;
  #archived?: boolean;

  constructor(
    client: AxiosInstance,
    name: string,
    owner: User,
    cloneUrl: string,
    sshUrl: string,
    archived: boolean
  ) {
    this.#name = name;
    this.#owner = owner;
    this.#cloneUrl = cloneUrl;
    this.#archived = archived;
    this.#sshUrl = sshUrl;
    this.#client = client;
  }

  /**
   * Returns the name of repository.
   * @returns {string} Name of repository.
   */
  get name(): string {
    return this.#name;
  }

  get organization(): string {
    return this.#owner.login;
  }

  get repoUrl(): string {
    const owner = this.organization;
    const repo = this.name;
    return `/repos/${owner}/${repo}`;
  }

  public checkout(branch: string, startPoint?: string): Checkout {
    return new Checkout(this, branch, startPoint);
  }

  async createBlob(content: Buffer): Promise<GitObject> {
    const url = `${this.repoUrl}/git/blobs`;
    const base64Content = content.toString("base64");
    const res = await this.#client.post<GitObject>(url, {
      content: base64Content,
      encoding: "base64",
    });

    res.data.type = ObjectType.Blob;

    return res.data;
  }

  async getBlob(url: string): Promise<Buffer> {
    const res = await this.#client.get<Buffer>(url, {
      transformResponse: (res) => {
        const parsed = JSON.parse(res);
        return Buffer.from(parsed.content, "base64");
      },
    });
    return res.data;
  }

  async getTree(commit: Commit, recursive = true): Promise<Tree> {
    const treeSha = commit.tree.sha;
    return await this.getTreeFromSha(treeSha, recursive);
  }

  async getTreeFromSha(sha: string, recursive = true): Promise<Tree> {
    const url = `${
      this.repoUrl
    }/git/trees/${sha}?recursive=${recursive.toString()}`;

    const result = await this.#client.get<Tree>(url);
    return result.data;
  }

  private failIfTruncated(tree: Tree): void {
    if (tree.truncated) {
      throw new Error("unable to fetch entire tree.");
    }
  }

  async getMatchingFiles(branch: string, pattern: string): Promise<File[]> {
    const latestCommit = await this.getLatestCommitToBranch(branch);
    const tree = await this.getTree(latestCommit);

    this.failIfTruncated(tree);

    const mm = new Minimatch(pattern, { matchBase: true });

    return tree.tree
      .filter(
        (to) =>
          (to.type === ObjectType.Blob || to.type === ObjectType.Commit) &&
          mm.match(to.path)
      )
      .map((to) => ({
        type: to.type,
        size: to.size,
        sha: to.sha,
        path: to.path,
        mode: to.mode,
        name: p.basename(to.path),
        url: to.url,
      }));
  }

  async getMatchingFilesWithContent(
    branch: string,
    pattern: string
  ): Promise<File[]> {
    const matchingFiles = await this.getMatchingFiles(branch, pattern);

    const filesPromise = matchingFiles.map(async (f) => {
      f.content = await this.getBlob(f.url);
      return f;
    });

    return await Promise.all(filesPromise);
  }

  async fetchBranch(branch: string, writer: GitObjectWriter): Promise<void> {
    const latestCommit = await this.getLatestCommitToBranch(branch);
    return await this.fetch(latestCommit, writer);
  }

  async fetch(commit: Commit, writer: GitObjectWriter): Promise<void> {
    const tree = await this.getTree(commit);

    this.failIfTruncated(tree);

    const fileWriterPromises = tree.tree
      .filter((obj) => obj.type === ObjectType.Blob)
      .map(async (obj) => {
        const data = await this.getBlob(obj.url);
        await writer(obj.path, obj.mode, data);
      });

    await Promise.all(fileWriterPromises);
  }

  async createTree(changes: Change[], base?: string): Promise<Tree> {
    const url = `${this.repoUrl}/git/trees`;
    type CreateTree = { base_tree?: string; tree: Change[] };

    /* eslint-disable @typescript-eslint/camelcase */
    const createBody: CreateTree = base
      ? { base_tree: base, tree: changes }
      : { tree: changes };
    /* eslint-enable @typescript-eslint/camelcase */
    const res = await this.#client.post(url, createBody);

    return res.data;
  }

  async createCommit(
    branch: string,
    message: string,
    changes: Change[],
    delta = true
  ): Promise<Ref> {
    const latestCommit = await this.getLatestCommitToBranch(branch);

    const tree = delta
      ? await this.createTree(changes, latestCommit.tree.sha)
      : await this.createTree(changes);

    const url = `${this.repoUrl}/git/commits`;
    const { data: commit } = await this.#client.post<Commit>(url, {
      tree: tree.sha,
      parents: [latestCommit.sha],
      message,
    });

    return await this.updateBranch(branch, commit.sha);
  }

  async updateBranch(name: string, sha: string): Promise<Ref> {
    const url = `${this.repoUrl}/git/refs/heads/${name}`;
    const res = await this.#client.patch<Ref>(url, { sha });
    return res.data;
  }

  async getBranch(name: string): Promise<Ref | null> {
    const ref = `heads/${name}`;
    const refUrl = `${this.repoUrl}/git/ref/${ref}`;
    const res = await notFoundToNull(this.#client.get<Ref>(refUrl));
    return res.data;
  }

  async createBranchFromSha(name: string, sha: string): Promise<Ref> {
    const ref = `refs/heads/${name}`;
    const refUrl = `${this.repoUrl}/git/refs`;

    const res = await this.#client.post<Ref>(refUrl, { ref, sha });
    return res.data;
  }

  async createBranch(name: string, branch: string): Promise<Ref> {
    const commit = await this.getLatestCommitToBranch(branch);
    return await this.createBranchFromSha(name, commit.sha);
  }

  /**
   * Deletes the given branch.
   * @param {string} branch Name of the branch.
   */
  async deleteBranch(branch: string): Promise<void> {
    const ref = `heads/${branch}`;
    const url = `${this.repoUrl}/git/refs/${ref}`;
    await this.#client.delete(url);
  }

  /**
   * Returns latest commit to branch of the GitHub repository.
   * @returns {GitObject} Commit object, as returned by GitHub API.
   */
  async getLatestCommitToBranch(branch: string): Promise<Commit> {
    const branchRef = await this.getBranch(branch);

    if (branchRef === null) {
      throw new Error(`No such branch ${branch}`);
    }

    const url = `${this.repoUrl}/git/commits/${branchRef.object.sha}`;

    const result = await this.#client.get<Commit>(url);
    return result.data;
  }

  async getLatestCommitToMaster(): Promise<Commit> {
    return await this.getLatestCommitToBranch("master");
  }
}

function notFoundToNull<T>(
  promise: Promise<AxiosResponse<T>>
): Promise<AxiosResponse<T | null>> {
  return promise.catch((err) => {
    const axiosErr = err as AxiosError;
    if (axiosErr.response?.status === 404) {
      axiosErr.response.data = null;
      return axiosErr.response;
    } else {
      throw err;
    }
  });
}

export interface File {
  type: ObjectType;
  size: number;
  name: string;
  path: string;
  mode: ObjectMode;
  content?: Buffer;
  sha: string;
  url: string;
}

export enum ObjectType {
  Blob = "blob",
  Tree = "tree",
  Commit = "commit",
}

export enum ObjectMode {
  File = "100644",
  Executable = "100755",
  Directory = "040000",
  Submodule = "160000",
  Symlink = "120000",
}

export interface GitObject {
  type: ObjectType;
  sha: string;
  url: string;
}

export interface Tree {
  sha: string;
  url: string;
  tree: TreeObject[];
  truncated: boolean;
}

export interface TreeObject {
  path: string;
  mode: ObjectMode;
  type: ObjectType;
  sha: string;
  size: number;
  url: string;
}

export interface Ref {
  ref: string;
  node_id: string;
  url: string;
  object: GitObject;
}

export interface Commit {
  sha: string;
  url: string;
  author: CommitUser;
  committer: CommitUser;
  message: string;
  tree: GitObject;
  parents: GitObject[];
}

export interface CommitUser {
  date: string;
  name: string;
  email: string;
}

export interface Change {
  sha?: string | null;
  content?: string;
  path: string;
  mode: ObjectMode;
  type: ObjectType;
}

export interface GitObjectWriter {
  (path: string, mode: ObjectMode, content: Buffer): Promise<void>;
}
