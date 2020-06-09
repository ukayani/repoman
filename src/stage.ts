import {
  Change,
  ObjectMode,
  ObjectType,
  Predicate,
  Ref,
  Repository,
  TreeObject,
} from "./repository";
import { LocalFile } from "./filesystem";
import { addFile, deleteFile, diffFiles, moveFile } from "./diff";

// use a map instead
type ChangeMap = Record<string, Change>;

enum ChangeType {
  Modify = "Modify",
  Add = "Add",
  Delete = "Delete",
  Move = "Move",
}

interface ChangeEntry {
  type: ChangeType;
  src?: string;
  dest?: string;
  srcContent?: Buffer;
  destContent?: Buffer;
}

interface ChangeResult {
  changes: ChangeMap;
  entries: ChangeEntry[];
}

interface ChangeApplicator {
  (changes: ChangeMap): Promise<ChangeResult>;
}

interface ChangeSet {
  changes: ChangeApplicator[];
}

export class Stage {
  readonly #repository: Repository;
  readonly #branch: string;
  readonly #changes: ChangeSet[];

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
    this.#changes.push({
      changes: [this.add(path, Buffer.from(content), mode)],
    });

    return this;
  }

  public addLocalFiles(files: LocalFile[], basePath?: string): Stage {
    this.#changes.push({
      changes: files.map((file) => {
        const filePath = basePath ? file.pathWithBase(basePath) : file.path;
        return this.add(filePath, file.data, file.mode);
      }),
    });
    return this;
  }

  public modifyFiles(
    predicate: Predicate<TreeObject>,
    modifier: (
      path: string,
      content: Buffer,
      mode: ObjectMode
    ) => Promise<{ content: Buffer; mode: ObjectMode }>
  ): Stage {
    this.#changes.push({
      changes: [
        async (changes) => {
          const files = await this.#repository.getFilesWithContent(
            this.#branch,
            predicate
          );
          const applicatorPromises = files
            .filter((f) => f.content)
            .map(async (f) => {
              const modified = await modifier(f.path, f.content, f.mode);
              return this.modify(
                f.path,
                f.content,
                modified.content,
                modified.mode
              );
            });
          const applicators = await Promise.all(applicatorPromises);
          return await this.sequence(applicators)(changes);
        },
      ],
    });

    return this;
  }

  public deleteFile(path: string): Stage {
    this.#changes.push({
      changes: [
        async (changes) => {
          const single = await this.delete(path);

          const applicators = Object.keys(changes)
            .filter((k) => k.startsWith(path + "/"))
            .map((p) => this.delete(p));

          const second = this.sequence(applicators);
          return await this.join(single, second)(changes);
        },
      ],
    });

    return this;
  }

  public moveFile(src: string, dest: string): Stage {
    this.#changes.push({
      changes: [
        async (changes) => {
          if (src in changes) {
            const single = this.move(src, dest);

            if (changes[src].type === ObjectType.Tree) {
              const applicators = Object.keys(changes)
                .filter((k) => k.startsWith(src + "/"))
                .map((k) => {
                  const newPath = k.replace(new RegExp("^" + src), dest);
                  return this.move(k, newPath);
                });
              const second = this.sequence(applicators);
              return await this.join(single, second)(changes);
            } else {
              return await single(changes);
            }
          }
          return { changes: changes, entries: [] };
        },
      ],
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
      async (changesPromise, changeSet) => {
        const changes = await changesPromise;
        const changeResults = await this.sequence(changeSet.changes)(changes);
        changeResults.entries.forEach((entry) => {
          console.log(this.changelog(entry));
        });
        return changeResults.changes;
      },
      Promise.resolve(existingChangesMap)
    );

    const changeList = Object.keys(finalChangesMap).map(
      (k) => finalChangesMap[k]
    );
    return this.#repository.createCommit(
      this.#branch,
      message,
      changeList,
      false
    );
  }

  private changelog(entry: ChangeEntry): string {
    if (entry.type === ChangeType.Modify) {
      return diffFiles(entry.src, entry.srcContent, entry.destContent);
    } else if (entry.type === ChangeType.Add) {
      return addFile(entry.dest, entry.destContent);
    } else if (entry.type === ChangeType.Delete) {
      return deleteFile(entry.src);
    } else {
      return moveFile(entry.src, entry.dest);
    }
  }

  private add(
    path: string,
    content: Buffer,
    mode: ObjectMode,
    type = ObjectType.Blob
  ): ChangeApplicator {
    return async (changes) => {
      const cloned = { ...changes };
      const blob = await this.#repository.createBlob(content);
      cloned[path] = {
        path: path,
        sha: blob.sha,
        mode,
        type,
      };
      return {
        changes: cloned,
        entries: [
          {
            type: ChangeType.Add,
            dest: path,
            destContent: content,
          },
        ],
      };
    };
  }

  private modify(
    path: string,
    srcContent: Buffer,
    destContent: Buffer,
    destMode: ObjectMode
  ): ChangeApplicator {
    return async (changes) => {
      const cloned = { ...changes };
      const blob = await this.#repository.createBlob(destContent);
      cloned[path] = {
        path: path,
        sha: blob.sha,
        mode: destMode,
        type: ObjectType.Blob,
      };
      return {
        changes: cloned,
        entries: [
          {
            type: ChangeType.Modify,
            src: path,
            dest: path,
            srcContent: srcContent,
            destContent: destContent,
          },
        ],
      };
    };
  }

  private delete(path: string): ChangeApplicator {
    return async (changes) => {
      const cloned = { ...changes };
      delete cloned[path];

      return {
        changes: cloned,
        entries: [
          {
            type: ChangeType.Delete,
            src: path,
          },
        ],
      };
    };
  }

  private move(src: string, dest: string): ChangeApplicator {
    return async (changes) => {
      const cloned = { ...changes };

      const change = cloned[src];
      delete cloned[src];
      change.path = dest;
      cloned[dest] = change;

      return {
        changes: cloned,
        entries: [
          {
            type: ChangeType.Move,
            src: src,
            dest: dest,
          },
        ],
      };
    };
  }

  private join(a: ChangeApplicator, b: ChangeApplicator): ChangeApplicator {
    return async (changes: ChangeMap) => {
      const changeResultA = await a(changes);
      const changeResultB = await b(changeResultA.changes);
      return {
        changes: changeResultB.changes,
        entries: [...changeResultA.entries, ...changeResultB.entries],
      };
    };
  }

  private sequence(results: ChangeApplicator[]): ChangeApplicator {
    return async (changes) => {
      //todo: use join to reduce
      return await results.reduce(
        async (results, applicator) => {
          const resolvedResults = await results;
          const result = await applicator(resolvedResults.changes);
          return {
            changes: result.changes,
            entries: [...resolvedResults.entries, ...result.entries],
          };
        },
        Promise.resolve({
          changes: changes,
          entries: [],
        })
      );
    };
  }
}
