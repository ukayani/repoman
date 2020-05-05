import { Change, ObjectMode, ObjectType, Ref, Repository } from "./repository";
import { LocalFile } from "./filesystem";

// use a map instead
type ChangeMap = Record<string, Change>;

interface ChangeApplicator {
  (changes: ChangeMap): Promise<ChangeMap>;
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

  public addFile(
    path: string,
    content: string,
    mode: ObjectMode = ObjectMode.File
  ): Stage {
    this.#changes.push(async (changes) => {
      const cloned = { ...changes };
      cloned[path] = { path, content, mode, type: ObjectType.Blob };
      return cloned;
    });

    return this;
  }

  public addLocalFiles(files: LocalFile[], basePath?: string): Stage {
    for (const file of files) {
      this.#changes.push(async (changes) => {
        const cloned = { ...changes };
        const filePath = basePath ? file.pathWithBase(basePath) : file.path;
        const blob = await this.#repository.createBlob(file.data);
        cloned[filePath] = {
          path: filePath,
          sha: blob.sha,
          mode: file.mode,
          type: ObjectType.Blob,
        };
        return cloned;
      });
    }

    return this;
  }

  public modifyFiles(
    pattern: string,
    modifier: (
      path: string,
      content: Buffer,
      mode: ObjectMode
    ) => Promise<{ content: Buffer; mode: ObjectMode }>
  ): Stage {
    this.#changes.push(async (changes) => {
      const cloned = { ...changes };
      const files = await this.#repository.getMatchingFilesWithContent(
        this.#branch,
        pattern
      );
      for (const file of files) {
        if (file.content) {
          const modified = await modifier(file.path, file.content, file.mode);
          const newBlob = await this.#repository.createBlob(modified.content);
          cloned[file.path] = {
            path: file.path,
            sha: newBlob.sha,
            mode: modified.mode,
            type: ObjectType.Blob,
          };
        }
      }
      return cloned;
    });

    return this;
  }

  public deleteFile(path: string): Stage {
    this.#changes.push(async (changes) => {
      const cloned = { ...changes };
      delete cloned[path];
      return cloned;
    });

    return this;
  }

  public deleteFolder(path: string): Stage {
    this.#changes.push(async (changes) => {
      const cloned = { ...changes };
      delete cloned[path];
      Object.keys(cloned)
        .filter((k) => k.startsWith(path + "/"))
        .forEach((k) => {
          delete cloned[k];
        });
      return cloned;
    });

    return this;
  }

  public moveFile(src: string, dest: string): Stage {
    this.#changes.push(async (changes) => {
      const cloned = { ...changes };
      if (src in cloned) {
        const change = cloned[src];
        delete cloned[src];
        change.path = dest;
        cloned[dest] = change;

        if (change.type === ObjectType.Tree) {
          Object.keys(cloned)
            .filter((k) => k.startsWith(src + "/"))
            .forEach((k) => {
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

  public async commit(message: string): Promise<Ref> {
    const latestCommit = await this.#repository.getLatestCommitToBranch(
      this.#branch
    );
    const latestTree = await this.#repository.getTree(latestCommit);

    if (latestTree.truncated) {
      throw new Error("Unable to retrieve all objects for current tree");
    }

    const existingChangesMap = latestTree.tree
      .filter((t) => t.type !== ObjectType.Tree)
      .reduce((acc, obj) => {
        acc[obj.path] = obj;
        return acc;
      }, {} as ChangeMap);

    const finalChangesMap = await this.#changes.reduce(
      async (changesPromise, applyChange) => {
        const changes = await changesPromise;
        return await applyChange(changes);
      },
      Promise.resolve(existingChangesMap)
    );

    const finalChanges = Object.keys(finalChangesMap).map(
      (k) => finalChangesMap[k]
    );
    return this.#repository.createCommit(
      this.#branch,
      message,
      finalChanges,
      false
    );
  }
}
