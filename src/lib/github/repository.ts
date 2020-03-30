import {AxiosError, AxiosInstance, AxiosResponse} from "axios";
import {Minimatch} from "minimatch";
import * as p from "path";
import {User} from "../github";
import {Stage} from "./stage";
import {Checkout} from "./checkout";

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

    public checkout(branch: string, startPoint?: string): Checkout {
        return new Checkout(this, branch, startPoint);
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

    private failIfTruncated(tree: Tree) {
        if (tree.truncated) {
            throw new Error('unable to fetch entire tree.');
        }
    }

    async getMatchingFiles(branch: string, pattern: string): Promise<File[]> {
        const latestCommit = await this.getLatestCommitToBranch(branch);
        const tree = await this.getTree(latestCommit);

        this.failIfTruncated(tree);

        const mm = new Minimatch(pattern);
        return tree.tree
            .filter(to => (to.type === ObjectType.Blob || to.type === ObjectType.Commit) && mm.match(to.path))
            .map(to => ({type: to.type, size: to.size, sha: to.sha, path: to.path, name: p.basename(to.path), url: to.url}));
    }

    async getMatchingFilesWithContent(branch: string, pattern: string): Promise<File[]> {
        const matchingFiles = await this.getMatchingFiles(branch, pattern);

        const filesPromise = matchingFiles.map(async f => {
            f.content = await this.getBlob(f.url);
            return f;
        });

        return await Promise.all(filesPromise);
    }

    async fetchBranch(branch: string, writer: GitObjectWriter): Promise<void> {
        const latestCommit = await this.getLatestCommitToBranch(branch);
        return await this.fetch(latestCommit, writer);
    }

    async fetch(commit: Commit, writer: GitObjectWriter): Promise<void> {
        const tree = await this.getTree(commit);

        this.failIfTruncated(tree);

        const fileWriterPromises = tree.tree
            .filter(obj => obj.type === ObjectType.Blob)
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

    async getHeads(name: string): Promise<Ref | null> {
        const ref = `heads/${name}`;
        const refUrl = `${this.repoUrl}/git/ref/${ref}`;
        const res = await notFoundToNull(this.#client.get<Ref>(refUrl));
        return res.data;
    }

    async createRef(name: string, sha: string) {
        const ref = `refs/heads/${name}`;
        const refUrl = `${this.repoUrl}/git/refs`;

        const res = await this.#client.post(refUrl, {ref, sha});
        return res.data;
    }

    async createRefFromBranch(name: string, branch: string) {
        const commit = await this.getLatestCommitToBranch(branch);
        return await this.createRef(name, commit.sha);
    }

    /**
     * Returns latest commit to master branch of the GitHub repository.
     * @returns {Object} Commit object, as returned by GitHub API.
     */
    async getLatestCommitToBranch(name: string): Promise<Commit> {
        const master = await this.getHeads(name);

        if (master === null) {
            throw new Error(`No such branch ${name}`);
        }

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

function notFoundToNull<T>(promise: Promise<AxiosResponse<T>>): Promise<AxiosResponse<T | null>> {
    return promise.catch(err => {
        const axiosErr = err as AxiosError;
        if (axiosErr.response?.status === 404) {
            axiosErr.response.data = null;
            return axiosErr.response;
        } else {
            throw err;
        }
    });
}

export interface File {
    type: ObjectType;
    size: number;
    name: string;
    path: string;
    content?: Buffer;
    sha: string;
    url: string;
}

export enum ObjectType {
    Blob = 'blob',
    Tree = 'tree',
    Commit = 'commit'
}

export enum ObjectMode {
    File = '100644',
    Executable = '100755',
    Directory = '040000',
    Submodule = '160000',
    Symlink = '120000'
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
    mode: ObjectMode;
    type: ObjectType;
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
    mode: ObjectMode;
    type: ObjectType;
}

export interface GitObjectWriter {
    (path: string, mode: ObjectMode, content: Buffer): Promise<void>;
}