/**
 * @fileoverview GitHub API calls.
 */

import axios, {AxiosInstance} from 'axios';
import {Config} from './config';
import {Repository} from './github/repository';

function getClient(config: Config) {
    return axios.create({
        baseURL: 'https://api.github.com',
        headers: {Authorization: `token ${config.githubToken}`},
    });
}

/**
 * Wraps some GitHub API calls.
 */
export class GitHub {
    protected config: Config;
    protected client: AxiosInstance;

    constructor(config: Config) {
        this.config = config;
        this.client = getClient(config);
    }

    async fetchRepositoriesFromGitHub(): Promise<GitHubRepository[]> {
        if (!this.config.repos) {
            return [];
        }
        type Repo = { name: string, owner: User, private: boolean, clone_url: string, ssh_url: string, archived: boolean };
        const repos = new Array<GitHubRepository>();
        const proms = this.config.repos.map(async repo => {
            const org = repo.org;
            if (repo.name) {
                const res = await this.client.get<Repo>(
                    `/repos/${org}/${repo.name}`
                );
                const rawRepo: Repo = res.data;
                const repository = new Repository(this.client, rawRepo.name, rawRepo.owner, rawRepo.clone_url,
                    rawRepo.ssh_url, rawRepo.archived);

                repos.push(new GitHubRepository(this.client, repository));
            } else {
                throw new Error(
                    'Each organization in the config must provide either a name or a regex.'
                );
            }
        });
        await Promise.all(proms);
        return repos;
    }

    /**
     * List all public repositories of the organization that match the regex
     * filter. Organization name and regex are taken from the configuration file.
     * @returns {GitHubRepository[]} Repositories matching the filter.
     */
    async getRepositories(): Promise<GitHubRepository[]> {
        const repos = new Array<GitHubRepository>();

        const githubRepos = await this.fetchRepositoriesFromGitHub();
        if (githubRepos.length > 0) {
            console.log(`Loaded ${githubRepos.length} repositories from GitHub.`);
        }

        const unique: { [key: string]: GitHubRepository } = {};
        for (const repo of githubRepos) {
            const name = `${repo.organization}/${repo.name}`;
            if (!(name in unique)) {
                repos.push(repo);
                unique[name] = repo;
            }
        }

        if (repos.length === 0) {
            throw new Error(
                'No repositories configured. Use config.repos and/or config.reposList.uri.'
            );
        }
        console.log(`Total ${repos.length} unique repositories loaded.`);
        return repos;
    }
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
     * @param {Object} octokit OctoKit instance.
     * @param {Object} repository Repository object, as returned by GitHub API.
     * @param {string} organization Name of GitHub organization.
     */
    constructor(
        client: AxiosInstance,
        repository: Repository
    ) {
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

    get git(): Repository {
        return this.#repository;
    }

    /**
     * Lists open pull requests in the repository.
     * @param {string} state Pull request state (open, closed), defaults to open.
     * @returns {Object[]} Pull request objects, as returned by GitHub API.
     */
    async listPullRequests(state: 'open' | 'closed' | 'all' = 'open') {
        const prs: PullRequest[] = [];
        const url = `${this.repoUrl}/pulls`;
        for (let page = 1; ; ++page) {
            const result = await this.#client.get<PullRequest[]>(url, {
                params: {state, page},
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
    async updateBranch(base: string, head: string) {
        const url = `${this.repoUrl}/merges`;
        const result = await this.#client.post(url, {base, head});
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
    ) {

        const url = `${this.repoUrl}/contents/${path}`;
        const result = await this.#client.put(url, {
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
    ) {
        const url = `${this.repoUrl}/contents/${path}`;
        const result = await this.#client.put(url, {message, content, sha, branch});
        return result.data;
    }

    /**
     * Creates a new pull request from the given branch to master.
     * @param {string} branch Branch name to create a pull request from.
     * @param {string} title Pull request title.
     * @param {string} body Pull request body.
     * @returns {Object} Pull request object, as returned by GitHub API.
     */
    async createPullRequest(branch: string, title: string, body: string) {
        const head = `refs/heads/${branch}`;
        const base = 'refs/heads/master';
        const url = `${this.repoUrl}/pulls`;
        const result = await this.#client.post(url, {
            head,
            base,
            title,
            body,
        });
        return result.data;
    }

    /**
     * Request a review for the existing pull request.
     * @param {number} prNumber Pull request number (the one visible in its URL).
     * @param {string[]} reviewers Reviewers' GitHub logins for the pull request.
     * @returns Review object, as returned by GitHub API.
     */
    async requestReview(prNumber: number, reviewers: string[]) {
        const url = `${this.repoUrl}/pulls/${prNumber}/requested_reviewers`;
        const result = await this.#client.post(url, {
            reviewers,
        });
        return result.data;
    }

    /**
     * Approves the given pull request.
     * @param {Object} pr Pull request object, as returned by GitHib API.
     * @returns Review object, as returned by GitHub API.
     */
    async approvePullRequest(pr: PullRequest) {
        const url = `${this.repoUrl}/pulls/${pr.number}/reviews`;
        const result = await this.#client.post(url, {event: 'APPROVE'});
        return result.data;
    }

    /**
     * Renames the given pull request.
     * @param {Object} pr Pull request object, as returned by GitHib API.
     * @param {string} title New title to give the PR
     * @returns Review object, as returned by GitHub API.
     */
    async renamePullRequest(pr: PullRequest, title: string) {
        const url = `${this.repoUrl}/pulls/${pr.number}`;
        const result = await this.#client.patch(url, {title});
        return result.data;
    }

    /**
     * Applies a set of labels to a given pull request.
     * @param {Object} pr Pull request object, as returned by GitHib API.
     * @param {Array<string>} labels Labels to apply to the PR
     * @returns A list of labels that was added to the issue..
     */
    async tagPullRequest(pr: PullRequest, labels: string[]) {
        const url = `${this.repoUrl}/issues/${pr.number}/labels`;
        const result = await this.#client.post(url, {labels});
        return result.data;
    }

    /**
     * Closes the given pull request without merging it.
     * @param {Object} pr Pull request object, as returned by GitHub API.
     */
    async closePullRequest(pr: PullRequest) {
        const url = `${this.repoUrl}/pulls/${pr.number}`;
        const result = await this.#client.patch(url, {state: 'closed'});
        return result.data;
    }

    /**
     * Merges the given pull request.
     * @param {Object} pr Pull request object, as returned by GitHib API.
     * @returns Merge object, as returned by GitHub API.
     */
    async mergePullRequest(pr: PullRequest) {
        const title = pr.title;
        const url = `${this.repoUrl}/pulls/${pr.number}/merge`;
        const result = await this.#client.put(url, {
            merge_method: 'squash',
            commit_title: title,
        });
        return result.data;
    }

    /**
     * Returns branch settings for the given branch.
     * @param {string} branch Name of the branch.
     * @returns {Object} Branch object, as returned by GitHub API.
     */
    async getBranch(branch: string) {
        const url = `${this.repoUrl}/branches/${branch}`;
        const result = await this.#client.get<Branch>(url);
        return result.data;
    }

    /**
     * Returns branch protection settings for master branch.
     * @returns {Object} Branch protection object, as returned by GitHub API.
     */
    async getRequiredMasterBranchProtection() {
        const branch = 'master';
        const url = `${this.repoUrl}/branches/${branch}/protection`;
        const result = await this.#client.get(url);
        return result.data;
    }

    /**
     * Returns branch protection status checks for master branch.
     * @returns {Object} Status checks object, as returned by GitHub API.
     */
    async getRequiredMasterBranchProtectionStatusChecks() {
        const branch = 'master';
        const url = `${this.repoUrl}/branches/${branch}/protection/required_status_checks`;
        const result = await this.#client.get<StatusCheck[]>(url);
        return result.data;
    }

    /**
     * Updates branch protection status checks for master branch.
     * @param {string[]} contexts Required status checks.
     * @returns {Object} Status checks object, as returned by GitHub API.
     */
    async updateRequiredMasterBranchProtectionStatusChecks(contexts: string[]) {
        const branch = 'master';
        const strict = true;
        const url = `${this.repoUrl}/branches/${branch}/protection/required_status_checks`;
        const result = await this.#client.patch(url, {strict, contexts});
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
        permission: 'pull' | 'push' | 'admin'
    ) {
        const url = `${this.repoUrl}/collaborators/${username}`;
        const result = await axios.put(url, {permission});
        return result.data;
    }
}

export interface PullRequest {
    number: number;
    title: string;
    html_url: string;
    patch_url: string;
    user: User;
    base: { sha: string };
    head: { ref: string; label: string };
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

export {toDir as DirectoryWriter} from './github/filesystem';