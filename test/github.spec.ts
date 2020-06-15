/* eslint-disable @typescript-eslint/camelcase */
import * as assert from "assert";
import { describe, it } from "mocha";
import * as nock from "nock";
import { GitHub } from "../src";
import * as data from "./github.data";
import { GitHubAPINock } from "./github.data";

nock.disableNetConnect();

const token = "fake";
const user = "ukayani";
const testRepo = "git-test";
const testRepo2 = "another-test";

function repoPath(name: string, user: string): string {
  return `/repos/${user}/${name}`;
}

//nock.recorder.rec();

describe("GitHub", () => {
  it("should get single repository", async () => {
    const github = new GitHub(token);
    const mock = GitHubAPINock.from(token);
    mock.get(repoPath(testRepo, user), data.repo(testRepo, user));
    const repo = await github.getRepository(testRepo, user);
    mock.clear();
    assert.strictEqual(repo.name, testRepo);
    assert.strictEqual(repo.organization, user);
  });

  it("should get repositories by RepoID", async () => {
    const github = new GitHub(token);
    const mock = GitHubAPINock.from(token);

    mock
      .get(repoPath(testRepo, user), data.repo(testRepo, user))
      .get(repoPath(testRepo2, user), data.repo(testRepo2, user));
    const repos = await github.getRepositories([
      { name: testRepo, org: user },
      { name: testRepo2, org: user },
    ]);

    mock.clear();
    assert.strictEqual(repos.length, 2);
  });

  it("should fetch paged results", async () => {
    const github = new GitHub(token);
    const mock = GitHubAPINock.from(token);
    mock.getPaged(
      "/user/repos",
      { visibility: "all", affiliation: "owner,organization_member" },
      data.repos(["testing", "hello", "blue", "green", "red"], "ukayani"),
      3
    );

    const repos = await github.getRepositoriesMatching(async (_) => true);
    mock.clear();
    assert.strictEqual(repos.length, 5);
  });

  it("should retry when github responds with abuse limit", async () => {
    const github = new GitHub(token);
    const mock = GitHubAPINock.from(token);
    mock.getWithAbuseLimit(
      repoPath(testRepo, user),
      data.repo(testRepo, user),
      2
    );

    const repo = await github.getRepository(testRepo, user);
    mock.clear();
    assert.strictEqual(repo.name, testRepo);
  });

  it("should return unique list of repos for .getRepositoriesByCode", async () => {
    const github = new GitHub(token);
    const mock = GitHubAPINock.from(token);
    const query = "spring-boot org:ukayani filename:pom.xml";

    mock.getWithQuery(
      "/search/code",
      { q: query },
      {
        total_count: 3,
        incomplete_results: false,
        items: [
          data.codeFile("pom.xml", testRepo, user),
          data.codeFile("pom.xml", testRepo2, user),
          data.codeFile("inner/pom.xml", testRepo, user),
        ],
      }
    );

    const repos = await github.getRepositoriesByCode(query);
    mock.clear();
    assert.strictEqual(repos.length, 2);
    assert.ok(repos.find((r) => r.name === testRepo) !== undefined);
    assert.ok(repos.find((r) => r.name === testRepo2) !== undefined);
  });
});
