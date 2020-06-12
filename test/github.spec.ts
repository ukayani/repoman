import * as assert from "assert";
import { describe, it } from "mocha";
import * as nock from "nock";
import { GitHub } from "../src";

nock.disableNetConnect();
const url = "https://api.github.com";
const token = "fake";
const org = "ukayani";
const repo = "git-test";

function mockGet(path: string, body: any): nock.Scope {
  return nock(url, { reqheaders: { authorization: `token ${token}` } })
    .get(path)
    .reply(200, body);
}

describe("GitHub", () => {
  it("should get the list of repositories", async () => {
    const github = new GitHub("fake");
    assert.ok(true);
    const path = `/repos/${org}/${repo}`;
    const scope = mockGet(path, { name: "git-test", owner: "ukayani" });
    const repos = await github.getRepository("git-test", "ukayani");
    scope.done();
    assert.strictEqual(repos.name, "git-test");
  });
});
