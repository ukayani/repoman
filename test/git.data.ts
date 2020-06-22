/* eslint-disable @typescript-eslint/camelcase */
import {
  Commit,
  CommitUser,
  GitObject,
  ObjectType,
  Ref,
} from "../src/repository";
import { blobSha, gitSha } from "../src/sha";

const githubApiUrl = "https://api.github.com";

export class RepoData {
  private org: string;
  private name: string;

  constructor(org: string, name: string) {
    this.org = org;
    this.name = name;
  }

  public baseURI() {
    return `${githubApiUrl}/repos/${this.org}/${this.name}`;
  }

  public createBlob(content: string): GitObject {
    const sha = blobSha(Buffer.from(content));
    return {
      sha,
      type: ObjectType.Blob,
      url: `${this.baseURI()}/git/blobs/${sha}`,
    };
  }

  public createCommit(username: string, message: string): Commit {
    const commitSha = gitSha("commit", Buffer.from(message));
    const parentSha = gitSha("commit", Buffer.from(`parent of ${commitSha}`));
    const treeSha = gitSha("tree", Buffer.from(`tree of ${commitSha}`));
    const date = new Date();

    const user: CommitUser = {
      name: username,
      email: `${username}@gmail.com`,
      date: date.toISOString(),
    };

    return {
      sha: commitSha,
      url: `${this.baseURI()}/git/commits/${commitSha}`,
      author: user,
      committer: user,
      tree: {
        type: ObjectType.Tree,
        sha: treeSha,
        url: `${this.baseURI()}/git/trees/${treeSha}`,
      },
      message,
      parents: [
        {
          sha: parentSha,
          url: `${this.baseURI()}/git/commits/${parentSha}`,
          type: ObjectType.Commit,
        },
      ],
    };
  }

  public createRef(branch: string, commit: Commit): Ref {
    return {
      ref: `refs/heads/${branch}`,
      object: { type: ObjectType.Commit, sha: commit.sha, url: commit.url },
      url: `${this.baseURI()}/git/refs/heads/${branch}`,
    };
  }
}
