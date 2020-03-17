// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview GitHub API calls.
 */

import axios, {AxiosInstance} from 'axios';
import {Config} from './config';
import {createGunzip} from "zlib";

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

// todo: use a map instead
interface ChangeMap {
    [path: string]: Change;
}

interface ChangeApplicator {
    (changes: ChangeMap): Promise<ChangeMap>
}

export class Stage {
    readonly #repository: Repository;
    readonly #branch: string;
    readonly #changes: ChangeApplicator[];

    constructor(repository: Repository, branch: string) {
        this.#repository = repository;
        this.#branch = branch;
        this.#changes = [];
    }

    public addFile(path: string, content: string, mode: '100644' | '100755' = '100644'): Stage {
        this.#changes.push(async changes => {
            const cloned = {...changes};
            cloned[path] = {path, content, mode, type: 'blob'};
            return cloned;
        });

        return this;
    }

    public deleteFile(path: string): Stage {
        this.#changes.push(async changes => {
            let cloned = {...changes};
            delete cloned[path];
            return cloned;
        });

        return this;
    }

    public deleteFolder(path: string): Stage {
        this.#changes.push(async changes => {
            let cloned = {...changes};
            delete cloned[path];
            Object.keys(cloned).filter(k => k.startsWith(path + '/')).forEach(k => {
                delete cloned[k];
            });
            return cloned;
        });

        return this;
    }

    public moveFile(src: string, dest: string): Stage {
        this.#changes.push(async changes => {
            const cloned = {...changes};
            if (src in cloned) {
                const change = cloned[src];
                delete cloned[src];
                change.path = dest;
                cloned[dest] = change;

                if (change.type === 'tree') {
                    Object.keys(cloned).filter(k => k.startsWith(src + '/')).forEach(k => {
                        const existing = cloned[k];
                        delete cloned[k];
                        const newPath = k.replace(new RegExp("^" + src), dest);
                        existing.path = newPath;
                        cloned[newPath] = existing;
                    });
                }
            }
            return cloned;
        });
        return this;
    }

    public async commit(message: string): Promise<Commit> {
        const latestCommit = await this.#repository.getLatestCommitToBranch(this.#branch);
        const latestTree = await this.#repository.getTree(latestCommit);

        if (latestTree.truncated) {
            throw new Error("Unable to retrieve all objects for current tree");
        }

        const existingChangesMap = latestTree.tree.reduce((acc, obj) => {
            acc[obj.path] = obj;
            return acc;
        }, {} as ChangeMap);

        const finalChangesMap = await this.#changes.reduce(async (changesPromise, applyChange) => {
            const changes = await changesPromise;
            return await applyChange(changes);
        }, Promise.resolve(existingChangesMap));

        const finalChanges = Object.keys(finalChangesMap).map(k => finalChangesMap[k]);
        return this.#repository.createCommit(this.#branch, message, finalChanges, false);
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

export class Repository {
    #client: AxiosInstance;
    #name: string;
    #owner: User;
    #clone_url?: string;
    #ssh_url?: string;
    #archived?: boolean;

    constructor(client: AxiosInstance, name: string, owner: User, clone_url: string, ssh_url: string, archived: boolean) {
        this.#name = name;
        this.#owner = owner;
        this.#clone_url = clone_url;
        this.#archived = archived;
        this.#ssh_url = ssh_url;
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

    public stage(branch: string): Stage {
        return new Stage(this, branch);
    }

    async createBlob(content: Buffer): Promise<Object> {
        const url = `${this.repoUrl}/git/blobs`;
        const base64Content = content.toString('base64');
        const res = await this.#client.post<Object>(url, {content: base64Content, encoding: 'base64'});
        res.data.type = 'blob';
        return res.data;
    }

    async getBlob(url: string): Promise<Buffer> {
        const res = await this.#client.get<Buffer>(url, {
            transformResponse:
                    res => {
                        const parsed = JSON.parse(res);
                        return Buffer.from(parsed.content, 'base64');
                    }
        });
        return res.data;
    }

    async getTree(commit: Commit, recursive: boolean = true): Promise<Tree> {
        const treeSha = commit.tree.sha;
        return await this.getTreeFromSha(treeSha, recursive);
    }

    async getTreeFromSha(sha: string, recursive: boolean = true): Promise<Tree> {
        const url = `${this.repoUrl}/git/trees/${sha}?recursive=${recursive.toString()}`;

        const result = await this.#client.get<Tree>(url);
        return result.data;
    }

    async fetchBranch(branch: string, writer: (path: string, mode: string, content: Buffer) => Promise<void>): Promise<void> {
        const latestCommit = await this.getLatestCommitToBranch(branch);
        return await this.fetch(latestCommit, writer);
    }

    async fetch(commit: Commit, writer: (path: string, mode: string, content: Buffer) => Promise<void>): Promise<void> {
        const tree = await this.getTree(commit);
        if (tree.truncated) {
            throw new Error('unable to fetch entire tree.');
        }

        const fileWriterPromises = tree.tree
            .filter(obj => obj.type === 'blob')
            .map(async (obj) => {
                const data = await this.getBlob(obj.url);
                await writer(obj.path, obj.mode, data);
            });

        await Promise.all(fileWriterPromises);
    }

    async createTree(changes: Change[], base?: string): Promise<Tree> {
        const url = `${this.repoUrl}/git/trees`;
        type CreateTree = { base_tree?: string, tree: Change[] };
        const createBody: CreateTree = (base) ? {base_tree: base, tree: changes} : {tree: changes};
        const res = await this.#client.post(url, createBody);

        return res.data;
    }

    async createCommit(branch: string, message: string, changes: Change[], delta: boolean = true) {
        const latestCommit = await this.getLatestCommitToBranch(branch);

        const tree = (delta) ? await this.createTree(changes, latestCommit.tree.sha) : await this.createTree(changes);

        const url = `${this.repoUrl}/git/commits`;
        const {data: commit} = await this.#client.post<Commit>(url, {
            tree: tree.sha,
            parents: [latestCommit.sha],
            message
        });

        return await this.updateHeadRef(branch, commit.sha);
    }

    async updateHeadRef(name: string, sha: string) {
        const url = `${this.repoUrl}/git/refs/heads/${name}`;
        const res = await this.#client.patch(url, {sha});
        return res.data;
    }

    async getHeads(name: string): Promise<Ref> {
        const ref = `heads/${name}`;
        const refUrl = `${this.repoUrl}/git/ref/${ref}`;
        const res = await this.#client.get<Ref>(refUrl);
        return res.data;
    }

    /**
     * Returns latest commit to master branch of the GitHub repository.
     * @returns {Object} Commit object, as returned by GitHub API.
     */
    async getLatestCommitToBranch(name: string): Promise<Commit> {
        const master = await this.getHeads(name);
        const url = `${this.repoUrl}/git/commits/${master.object.sha}`;

        const result = await this.#client.get<Commit>(url);
        return result.data;
    }

    async getLatestCommitToMaster(): Promise<Commit> {
        return await this.getLatestCommitToBranch("master");
    }

    /**
     * Creates a new branch in the given GitHub repository.
     * @param {string} branch Name of the new branch.
     * @param {string} sha SHA of the master commit to base the branch on.
     * @returns {Object} Reference object, as returned by GitHub API.
     */
    async createBranch(branch: string, sha: string) {
        const ref = `refs/heads/${branch}`;
        const url = `${this.repoUrl}/git/refs`;
        const result = await this.#client.post(url, {ref, sha});
        return result.data;
    }

    /**
     * Deletes the given branch.
     * @param {string} branch Name of the branch.
     */
    async deleteBranch(branch: string) {
        const ref = `heads/${branch}`;
        const url = `${this.repoUrl}/git/refs/${ref}`;
        await this.#client.delete(url);
    }

}

export interface User {
    login: string;
}

export interface Branches {
    [index: string]: {
        _latest: string;
    };
}

export interface File {
    type: string;
    encoding: string;
    size: number;
    name: string;
    path: string;
    content: string;
    sha: string;
    url: string;
    git_url: string;
    html_url: string;
    download_url: string;
    _links: { git: string; self: string; html: string };
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

export interface Object {
    type: string;
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
    mode: string;
    type: string;
    sha: string;
    size: number;
    url: string;
}

export interface Ref {
    ref: string;
    node_id: string;
    url: string;
    object: Object;
}

export interface Commit {
    sha: string;
    url: string;
    author: CommitUser;
    committer: CommitUser;
    message: string;
    tree: Object;
    parents: Object[];
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
    mode: string;
    type: string;
}