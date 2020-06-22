/* eslint-disable @typescript-eslint/camelcase */
import { describe, it } from "mocha";
import { anyString, anything, instance, mock, when } from "ts-mockito";
import { Repository } from "../src/repository";
import { Stage } from "../src/stage";
import * as assert from "assert";
import { RepoData } from "./git.data";

const data = new RepoData("ukayani", "git-test");

describe("Stage", () => {
  it("should add single file to existing repository", async () => {
    const repo: Repository = mock(Repository);
    const content = ".idea\n";
    when(repo.createBlob(anything())).thenResolve(data.createBlob(content));

    const commit = data.createCommit("ukayani", "test");
    when(repo.getLatestCommitToBranch("master")).thenResolve(commit);
    when(repo.getTree(commit)).thenResolve({
      truncated: false,
      tree: [],
      sha: "blah",
      url: "blah",
    });

    when(repo.createBranch("test", "master")).thenResolve(
      data.createRef("test", commit)
    );
    when(repo.createCommit("test", anyString(), anything(), false)).thenResolve(
      data.createRef("test", data.createCommit("ukayani", "added git ignore"))
    );

    const stage = new Stage(instance(repo), "test", "master");
    const ref = await stage
      .addFile(".gitignore", content)
      .commit("added git ignore");

    assert.equal("refs/heads/test", ref.ref);
  });
});
