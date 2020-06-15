/* eslint-disable @typescript-eslint/camelcase */
import { CodeFile, RawRepo, User } from "../src/github";
import * as nock from "nock";

const githubUrl = "https://github.com";
const githubApiUrl = "https://api.github.com";

function owner(username: string): User {
  return {
    id: 1,
    login: username,
  };
}

export function repos(names: string[], username: string): RawRepo[] {
  return names.map((n, i) => repo(n, username, i));
}

export function codeFile(
  name: string,
  repositoryName: string,
  username: string
): CodeFile {
  return {
    name,
    path: name,
    repository: repo(repositoryName, username),
    sha: "0",
    score: 1,
    git_url: `${getRepoApi(username, repositoryName)}/git/blobs/0`,
  };
}

function getRepoApi(username: string, name: string) {
  return `${githubApiUrl}/repos/${username}/${name}`;
}

export function repo(name: string, username: string, id = 1): RawRepo {
  const repoApi = getRepoApi(username, name);
  return {
    id,
    name,
    full_name: `${username}/${name}`,
    description: "test",
    owner: owner(username),
    private: true,
    clone_url: `${githubUrl}/${username}/${name}.git`,
    ssh_url: `git@github.com:${username}/${name}.git`,
    archived: false,
    fork: false,
    url: `${githubApiUrl}/repos/${username}/${name}`,
    blobs_url: `${repoApi}/git/blobs{/sha}`,
    trees_url: `${repoApi}/git/trees{/sha}`,
    pulls_url: `${repoApi}/pulls{/number}`,
    tags_url: `${repoApi}/tags`,
    language: "Java",
    forks_count: 1,
    stargazers_count: 1,
    watchers_count: 1,
    size: 71,
    default_branch: "master",
    open_issues_count: 0,
    topics: ["test", "auto"],
    has_issues: false,
    has_projects: false,
    has_wiki: false,
    disabled: false,
    pushed_at: "2020-06-10T22:55:56Z",
    created_at: "2020-03-11T03:06:08Z",
    updated_at: "2020-03-23T03:38:11Z",
    permissions: {
      pull: true,
      push: true,
      admin: true,
    },
    allow_rebase_merge: true,
    allow_squash_merge: true,
    allow_merge_commit: true,
    subscribers_count: 0,
  };
}

export class GitHubAPINock {
  private token: string;
  private scope: nock.Scope;

  static from(token: string): GitHubAPINock {
    return new GitHubAPINock(token);
  }

  constructor(token: string) {
    this.token = token;
    this.scope = nock(githubApiUrl, {
      reqheaders: { authorization: `token ${this.token}` },
    });
  }

  public get(path: string, body: Record<string, any>): GitHubAPINock {
    this.scope = this.scope.get(path).reply(200, body);
    return this;
  }

  public getWithQuery(
    path: string,
    query: Record<string, any>,
    body: Record<string, any>
  ): GitHubAPINock {
    this.scope = this.scope.get(path).query(query).reply(200, body);
    return this;
  }

  public getWithAbuseLimit(
    path: string,
    body: Record<string, any>,
    failures = 1
  ): GitHubAPINock {
    for (let i = 0; i < failures; i++) {
      this.scope = this.scope
        .get(path)
        .reply(401, null, { "Retry-After": "1" });
    }
    this.scope = this.scope.get(path).reply(200, body);

    return this;
  }

  public getPaged(
    path: string,
    query: Record<string, any>,
    elements: Record<string, any>[],
    numPages = 1
  ): GitHubAPINock {
    let elementsRemaining = elements.length;

    const pageSize = Math.round(elements.length / numPages);
    let start = 0;
    let page = 1;
    while (elementsRemaining > 0) {
      const take =
        page === numPages
          ? elementsRemaining
          : Math.min(pageSize, elementsRemaining);
      elementsRemaining -= take;
      const slice = elements.slice(start, start + take);
      start = start + take;
      const finalQuery = page === 1 ? query : { ...query, page };

      this.scope = this.scope
        .get(path)
        .query(finalQuery)
        .reply(200, slice, {
          Link: createLink(path, query, page, numPages),
        });
      page += 1;
    }

    return this;
  }

  public clear(): void {
    this.scope.done();
  }
}

function queryString(params: Record<string, any>): string {
  if (Object.keys(params).length === 0) {
    return "";
  }
  return (
    "?" +
    Object.entries(params)
      .map(([key, value]) => {
        return `${key}=${encodeURIComponent(value)}`;
      })
      .join("&")
  );
}

function createLink(
  path: string,
  query: Record<string, any>,
  pageNumber: number,
  numPages: number
) {
  const pageQuery = function (pageNum: number): string {
    return queryString({ ...query, page: pageNum });
  };

  const first = `<${githubApiUrl}${path}${pageQuery(1)}>; rel="first"`;
  const last = `<${githubApiUrl}${path}${pageQuery(numPages)}>; rel="last"`;

  if (numPages === 1) {
    return "";
  }

  if (pageNumber === 1) {
    return `<${githubApiUrl}${path}${pageQuery(
      pageNumber + 1
    )}>; rel="next",${last}`;
  }

  if (pageNumber < numPages) {
    return `<${githubApiUrl}${path}${pageQuery(
      pageNumber + 1
    )}>; rel="next",${last},${first},<${githubApiUrl}/${path}${pageQuery(
      pageNumber - 1
    )}>; rel="prev"`;
  }

  if (pageNumber === numPages) {
    return `<${githubApiUrl}${path}${pageQuery(
      pageNumber - 1
    )}>; rel="prev",${first}`;
  }
}
