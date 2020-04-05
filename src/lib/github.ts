/**
 * @fileoverview GitHub API calls.
 */

import axios, { AxiosInstance } from "axios";
import { Commit, Repository } from "./github/repository";
import { Checkout } from "./github/checkout";

function createClient(token: string): AxiosInstance {
  return axios.create({
    baseURL: "https://api.github.com",
    headers: { Authorization: `token ${token}` },
  });
}

/**
 * Wraps some GitHub API calls for the given repository.
 */
export class GitHubRepository {
  #repository: Repository;
  #client: AxiosInstance;

  /**
   * Creates an object to work with the given GitHub repository.
   * @constructor
   * @param {Object} axios github client
   * @param {Object} repository Repository object, as returned by GitHub API.
   */
  constructor(client: AxiosInstance, repository: Repository) {
    this.#client = client;
    this.#repository = repository;
  }

  get repoUrl(): string {
    return this.#repository.repoUrl;
  }

  get name(): string {
    return this.#repository.name;
  }

  get organization(): string {
    return this.#repository.organization;
  }

  /**
   * Access low level git api for repo
   */
  get git(): Repository {
    return this.#repository;
  }

  /**
   * Start a 'checkout' like step, to allow staging changes for commit
   * @param branch
   * @param startPoint
   */
  checkout(branch: string, startPoint?: string): Checkout {
    return this.#repository.checkout(branch, startPoint);
  }

  /**
   * Lists open pull requests in the repository.
   * @param {string} state Pull request state (open, closed), defaults to open.
   * @returns {Object[]} Pull request objects, as returned by GitHub API.
   */
  async listPullRequests(
    state: "open" | "closed" | "all" = "open"
  ): Promise<PullRequest[]> {
    const prs: PullRequest[] = [];
    const url = `${this.repoUrl}/pulls`;
    for (let page = 1; ; ++page) {
      const result = await this.#client.get<PullRequest[]>(url, {
        params: { state, page },
      });
      if (result.data.length === 0) {
        break;
      }
      prs.push(...result.data);
    }
    return prs;
  }

  /**
   * Merges one branch into another.
   * @param {string} base Name of branch to merge info.
   * @param {string} head Name of branch to merge from.
   * @returns {Object} Commit object of the merge commit, as returned by GitHub
   * API.
   */
  async updateBranch(base: string, head: string): Promise<Commit> {
    const url = `${this.repoUrl}/merges`;
    const result = await this.#client.post<Commit>(url, { base, head });
    return result.data;
  }

  /**
   * Creates a new file in the given branch and commits the change to
   * GitHub.
   * @param {string} branch Branch name to update.
   * @param {string} path Path to an existing file in that branch.
   * @param {string} message Commit message.
   * @param {string} content Base64-encoded content of the file.
   * @returns {Object} Commit object, as returned by GitHub API.
   */
  async createFileInBranch(
    branch: string,
    path: string,
    message: string,
    content: string
  ): Promise<Commit> {
    const url = `${this.repoUrl}/contents/${path}`;
    const result = await this.#client.put<Commit>(url, {
      message,
      content,
      branch,
    });
    return result.data;
  }

  /**
   * Updates an existing file in the given branch and commits the change to
   * GitHub.
   * @param {string} branch Branch name to update.
   * @param {string} path Path to an existing file in that branch.
   * @param {string} message Commit message.
   * @param {string} content Base64-encoded content of the file.
   * @param {string} sha SHA of the file to be updated.
   * @returns {Object} Commit object, as returned by GitHub API.
   */
  async updateFileInBranch(
    branch: string,
    path: string,
    message: string,
    content: string,
    sha: string
  ): Promise<Commit> {
    const url = `${this.repoUrl}/contents/${path}`;
    const result = await this.#client.put<Commit>(url, {
      message,
      content,
      sha,
      branch,
    });
    return result.data;
  }

  /**
   * Creates a new pull request from the given branch to master.
   * @param {string} branch Branch name to create a pull request from.
   * @param {string} title Pull request title.
   * @param {string} body Pull request body.
   * @returns {Object} Pull request object, as returned by GitHub API.
   */
  async createPullRequest(
    branch: string,
    title: string,
    body: string,
    reviewers?: string[]
  ): Promise<PullRequest> {
    const head = `refs/heads/${branch}`;
    const base = "refs/heads/master";
    const url = `${this.repoUrl}/pulls`;
    const { data: pr } = await this.#client.post<PullRequest>(url, {
      head,
      base,
      title,
      body,
    });

    if (reviewers && reviewers.length > 0) {
      return await this.requestReview(pr.number, reviewers);
    }

    return pr;
  }

  /**
   * Request a review for the existing pull request.
   * @param {number} prNumber Pull request number (the one visible in its URL).
   * @param {string[]} reviewers Reviewers' GitHub logins for the pull request.
   * @returns Review object, as returned by GitHub API.
   */
  async requestReview(
    prNumber: number,
    reviewers: string[]
  ): Promise<PullRequest> {
    const url = `${this.repoUrl}/pulls/${prNumber}/requested_reviewers`;
    const result = await this.#client.post<PullRequest>(url, {
      reviewers,
    });
    return result.data;
  }

  /**
   * Approves the given pull request.
   * @param {Object} pr Pull request object, as returned by GitHib API.
   * @returns Review object, as returned by GitHub API.
   */
  async approvePullRequest(pr: PullRequest): Promise<PullRequest> {
    const url = `${this.repoUrl}/pulls/${pr.number}/reviews`;
    const result = await this.#client.post<PullRequest>(url, {
      event: "APPROVE",
    });
    return result.data;
  }

  /**
   * Renames the given pull request.
   * @param {Object} pr Pull request object, as returned by GitHib API.
   * @param {string} title New title to give the PR
   * @returns Review object, as returned by GitHub API.
   */
  async renamePullRequest(
    pr: PullRequest,
    title: string
  ): Promise<PullRequest> {
    const url = `${this.repoUrl}/pulls/${pr.number}`;
    const result = await this.#client.patch<PullRequest>(url, { title });
    return result.data;
  }

  /**
   * Applies a set of labels to a given pull request.
   * @param {Object} pr Pull request object, as returned by GitHib API.
   * @param {Array<string>} labels Labels to apply to the PR
   * @returns A list of labels that was added to the issue..
   */
  async tagPullRequest(pr: PullRequest, labels: string[]): Promise<Label[]> {
    const url = `${this.repoUrl}/issues/${pr.number}/labels`;
    const result = await this.#client.post<Label[]>(url, { labels });
    return result.data;
  }

  /**
   * Closes the given pull request without merging it.
   * @param {Object} pr Pull request object, as returned by GitHub API.
   */
  async closePullRequest(pr: PullRequest): Promise<PullRequest> {
    const url = `${this.repoUrl}/pulls/${pr.number}`;
    const result = await this.#client.patch<PullRequest>(url, {
      state: "closed",
    });
    return result.data;
  }

  /**
   * Merges the given pull request.
   * @param {Object} pr Pull request object, as returned by GitHib API.
   * @returns Merge object, as returned by GitHub API.
   */
  async mergePullRequest(
    pr: PullRequest
  ): Promise<{ sha: string; merged: boolean; message: string }> {
    const title = pr.title;
    const url = `${this.repoUrl}/pulls/${pr.number}/merge`;
    /* eslint-disable @typescript-eslint/camelcase */
    const result = await this.#client.put(url, {
      merge_method: "squash",
      commit_title: title,
    });
    /* eslint-enable @typescript-eslint/camelcase */
    return result.data;
  }

  /**
   * Returns branch settings for the given branch.
   * @param {string} branch Name of the branch.
   * @returns {Object} Branch object, as returned by GitHub API.
   */
  async getBranch(branch: string): Promise<Branch> {
    const url = `${this.repoUrl}/branches/${branch}`;
    const result = await this.#client.get<Branch>(url);
    return result.data;
  }

  /**
   * Adds a collaborator to this repository.
   * @param {string} username Username of the new collaborator.
   * @param {string} permission Permission (pull, push, or admin, default:
   * push).
   * @returns {Object} As returned by GitHub API.
   */
  async addCollaborator(
    username: string,
    permission: "pull" | "push" | "admin"
  ): Promise<Repository> {
    const url = `${this.repoUrl}/collaborators/${username}`;
    const result = await this.#client.put(url, { permission });
    return result.data;
  }
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  patch_url: string;
  user: User;
  base: { sha: string; label: string };
  head: { ref: string; label: string };
  labels: Label[];
}

export interface Label {
  id: number;
  url: string;
  name: string;
  description: string;
  color: string;
  default: boolean;
}

export interface User {
  login: string;
}

export interface Branches {
  [index: string]: {
    _latest: string;
  };
}

export interface StatusCheck {
  url: string;
  strict: boolean;
  contexts: string[];
  contexts_url: string;
}

export interface Branch {
  protected: boolean;
}

/**
 * Wraps some GitHub API calls.
 */
export class GitHub {
  protected client: AxiosInstance;

  constructor(token: string) {
    this.client = createClient(token);
  }

  async getRepository(name: string, org: string): Promise<GitHubRepository> {
    type Repo = {
      name: string;
      owner: User;
      private: boolean;
      clone_url: string;
      ssh_url: string;
      archived: boolean;
    };
    const res = await this.client.get<Repo>(`/repos/${org}/${name}`);
    const rawRepo: Repo = res.data;
    const repository = new Repository(
      this.client,
      rawRepo.name,
      rawRepo.owner,
      rawRepo.clone_url,
      rawRepo.ssh_url,
      rawRepo.archived
    );

    return new GitHubRepository(this.client, repository);
  }

  async getRepositories(
    repos: { name: string; org: string }[]
  ): Promise<GitHubRepository[]> {
    const allRepos = repos.map(async (r) => {
      return await this.getRepository(r.name, r.org);
    });

    return await Promise.all(allRepos);
  }
}

export { toDir as DirectoryWriter } from "./github/filesystem";
