import {Change, Commit, ObjectMode, ObjectType, Repository} from "./repository";
import {LocalFile} from "./filesystem";

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

    public addFile(path: string, content: string, mode: ObjectMode = ObjectMode.File): Stage {
        this.#changes.push(async changes => {
            const cloned = {...changes};
            cloned[path] = {path, content, mode, type: ObjectType.Blob};
            return cloned;
        });

        return this;
    }

    public addLocalFile(path: string, file: LocalFile) {
        this.#changes.push(async changes => {
            const cloned = {...changes};
            const blob = await this.#repository.createBlob(file.data);
            cloned[path] = {path, sha: blob.sha, mode: file.mode, type: ObjectType.Blob};
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

                if (change.type === ObjectType.Tree) {
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
