/* eslint-disable @typescript-eslint/camelcase */
import { describe, it } from "mocha";
import {
  anyString,
  anything,
  capture,
  instance,
  mock,
  verify,
  when,
} from "ts-mockito";
import { Change, ObjectMode, ObjectType, Repository } from "../src/repository";
import { Stage } from "../src/stage";
import * as assert from "assert";
import { RepoData } from "./git.data";
import { gitSha } from "../src/sha";

const data = new RepoData("ukayani", "git-test");
const baseBranch = "master";

describe("Stage", () => {
  it("should add single file to existing repository", async () => {
    const branch = "test";
    const content = ".idea\n";
    const repo: Repository = createMockRepo("ukayani", branch, []);

    const stage = new Stage(instance(repo), branch, baseBranch);
    const result = await stage
      .addFile(".gitignore", content)
      .commit("added git ignore");

    assert.equal(result.branch, branch);
    const changes = getCommitedChanges(repo);
    const assertions = new ChangeAssertion(changes);
    assertions.hasFile(".gitignore");
  });

  it("should not create commit if nothing changed", async () => {
    const branch = "test";
    const content = ".idea\n";
    // setup repo with existing .gitignore having same content
    const repo: Repository = createMockRepo("ukayani", branch, [
      dir("src"),
      file("src/test.txt", "Hello World"),
      file(".gitignore", content),
    ]);

    const stage = new Stage(instance(repo), branch, baseBranch);
    const result = await stage
      .addFile(".gitignore", content)
      .commit("added git ignore");

    assert.equal(result.hasChanges(), false);
    verify(
      repo.createCommit(anything(), anything(), anything(), anything())
    ).never();
  });
});

function getCommitedChanges(repo: Repository): Change[] {
  return capture(repo.createCommit).last()[2];
}

function file(path: string, content: string): Change {
  const blob = data.createBlob(content);
  return {
    sha: blob.sha,
    path,
    mode: ObjectMode.File,
    type: ObjectType.Blob,
  };
}

function dir(path: string): Change {
  const sha = gitSha("tree", Buffer.from(path));
  return {
    sha,
    path,
    mode: ObjectMode.Directory,
    type: ObjectType.Tree,
  };
}

function createMockRepo(
  username: string,
  branch: string,
  changes: Change[]
): Repository {
  const repo: Repository = mock(Repository);
  when(repo.createBlob(anything())).thenCall(async (content) =>
    data.createBlob(content)
  );

  const commit = data.createCommit(username, "test");
  when(repo.getLatestCommitToBranch("master")).thenResolve(commit);
  when(repo.getTree(commit)).thenResolve({
    truncated: false,
    tree: changes.map((c) => ({
      sha: c.sha,
      path: c.path,
      type: c.type,
      mode: c.mode,
      size: c.content?.length,
      url: "url",
    })),
    sha: "blah",
    url: "blah",
  });

  when(repo.createBranch(branch, "master")).thenResolve(
    data.createRef(branch, commit)
  );
  when(repo.createCommit("test", anyString(), anything(), false)).thenCall(
    async (branch, message) => {
      return data.createRef(branch, data.createCommit(username, message));
    }
  );

  return repo;
}
class ChangeAssertion {
  private changes: Change[];

  constructor(changes: Change[]) {
    this.changes = changes;
  }

  public hasFile(path: string): void {
    const change = this.changes.find((c) => c.path === path);
    assert.ok(change, `Could not find matching file change for ${path}`);
  }
}
