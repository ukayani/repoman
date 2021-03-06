import { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { Minimatch } from "minimatch";
import * as p from "path";
import { User } from "./github";
import { Writers } from "./filesystem";
import { Stage } from "./stage";

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

  get sshUrl(): string {
    return this.#sshUrl;
  }

  get cloneUrl(): string {
    return this.#cloneUrl;
  }

  get archived(): boolean {
    return this.#archived;
  }

  get repoUrl(): string {
    const owner = this.organization;
    const repo = this.name;
    return `/repos/${owner}/${repo}`;
  }

  public checkout(branch: string, baseBranch = "master"): Stage {
    return new Stage(this, branch, baseBranch);
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

  async hasFileAtPath(branch: string, path: string): Promise<boolean> {
    const latestCommit = await this.getLatestCommitToBranch(branch);
    const tree = await this.getTree(latestCommit);

    this.failIfTruncated(tree);

    return tree.tree.findIndex((obj) => path === obj.path) !== -1;
  }

  async getFilesWithPredicate(
    branch: string,
    predicate: Predicate<TreeObject>
  ): Promise<File[]> {
    const latestCommit = await this.getLatestCommitToBranch(branch);
    const tree = await this.getTree(latestCommit);

    this.failIfTruncated(tree);
    return tree.tree
      .filter(
        (to) =>
          (to.type === ObjectType.Blob || to.type === ObjectType.Commit) &&
          predicate(to)
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

  async getFiles(branch: string, pattern: string): Promise<File[]> {
    return await this.getFilesWithPredicate(
      branch,
      ObjectPredicates.glob(pattern)
    );
  }

  async getFilesWithContent(
    branch: string,
    predicate: Predicate<TreeObject>
  ): Promise<File[]> {
    const matchingFiles = await this.getFilesWithPredicate(branch, predicate);

    const filesPromise = matchingFiles.map(async (f) => {
      f.content = await this.getBlob(f.url);
      return f;
    });

    return await Promise.all(filesPromise);
  }

  async fetchBranch(branch: string, writer: GitObjectWriter): Promise<void>;
  async fetchBranch(branch: string, dest: string): Promise<void>;

  async fetchBranch(
    branch: string,
    writer: GitObjectWriter | string
  ): Promise<void> {
    const latestCommit = await this.getLatestCommitToBranch(branch);
    if (isWriter(writer)) {
      return await this.fetch(latestCommit, writer);
    } else {
      return await this.fetch(latestCommit, writer);
    }
  }

  async fetch(commit: Commit, writer: GitObjectWriter): Promise<void>;
  async fetch(commit: Commit, dest: string): Promise<void>;

  async fetch(commit: Commit, writer: GitObjectWriter | string): Promise<void> {
    const tree = await this.getTree(commit);

    this.failIfTruncated(tree);

    let writerInstance: GitObjectWriter;
    if (isWriter(writer)) {
      writerInstance = writer;
    } else {
      writerInstance = Writers.toDir(writer);
    }

    const fileWriterPromises = tree.tree
      .filter((obj) => obj.type === ObjectType.Blob)
      .map(async (obj) => {
        const data = await this.getBlob(obj.url);
        await writerInstance(obj.path, obj.mode, data);
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

  async createBranch(name: string, branch = "master"): Promise<Ref> {
    const ref = await this.getBranch(this.name);

    if (ref !== null) return ref;

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
      throw new Error(`No such branch ${branch} for ${this.name}`);
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
export interface Predicate<T> {
  (t: T): boolean;
}

export class ObjectPredicates {
  public static glob(pattern: string, matchBase = true): Predicate<TreeObject> {
    const mm = new Minimatch(pattern, { matchBase: matchBase });
    return ((obj) => mm.match(obj.path)) as Predicate<TreeObject>;
  }

  public static pathEquals(path: string): Predicate<TreeObject> {
    return ((obj) => obj.path === path) as Predicate<TreeObject>;
  }
}

function isWriter(writer: GitObjectWriter | string): writer is GitObjectWriter {
  return !(typeof writer === "string");
}

export interface GitObjectWriter {
  (path: string, mode: ObjectMode, content: Buffer): Promise<void>;
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
