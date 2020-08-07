import {
  Change,
  GitObject,
  ObjectMode,
  ObjectPredicates,
  ObjectType,
  Predicate,
  Ref,
  Repository,
  TreeObject,
} from "./repository";
import { LocalFile } from "./filesystem";
import { addFile, deleteFile, diffFiles, moveFile } from "./diff";
import { blobSha } from "./sha";

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

export interface FileModifier {
  (path: string, content: Buffer, mode: ObjectMode): Promise<{
    content: Buffer;
    mode: ObjectMode;
  }>;
}

export interface SimpleFileModifier {
  (path: string, content: string): Promise<string>;
}

export interface ContentModifier {
  (content: string): Promise<string>;
}

export class Stage {
  readonly #repository: Repository;
  readonly #branch: string;
  readonly #baseBranch: string;
  readonly #changeSets: ChangeSet[];
  #dry = false;
  #_cachedBasedBranch?: string;

  constructor(repository: Repository, branch: string, baseBranch: string) {
    this.#repository = repository;
    this.#branch = branch;
    this.#changeSets = [];
    this.#baseBranch = baseBranch;
  }

  public dryRun(enabled = true): Stage {
    this.#dry = enabled;
    return this;
  }

  private async getBaseBranch(): Promise<string> {
    if (this.#_cachedBasedBranch) {
      return this.#_cachedBasedBranch;
    }
    const existing = await this.#repository.getBranch(this.#branch);
    const baseBranch = existing !== null ? this.#branch : this.#baseBranch;
    this.#_cachedBasedBranch = baseBranch;
    return baseBranch;
  }

  private createBlob(content: Buffer): Promise<GitObject> {
    if (!this.isDryRun()) {
      return this.#repository.createBlob(content);
    } else {
      return Promise.resolve({
        type: ObjectType.Blob,
        sha: blobSha(content),
        url: "n/a",
      });
    }
  }

  private async createCommit(message: string, changes: Change[]): Promise<Ref> {
    if (!this.isDryRun()) {
      await this.#repository.createBranch(this.#branch, this.#baseBranch);
      return await this.#repository.createCommit(
        this.#branch,
        message,
        changes,
        false
      );
    } else {
      return {
        ref: `refs/heads/${this.#branch}`,
        url: "n/a",
        object: { type: ObjectType.Commit, sha: "n/a", url: "n/a" },
      };
    }
  }

  private isDryRun(): boolean {
    return this.#dry;
  }

  public addFile(
    path: string,
    content: string,
    mode: ObjectMode = ObjectMode.File
  ): Stage {
    this.#changeSets.push({
      changes: [this.add(path, Buffer.from(content), mode)],
    });

    return this;
  }

  public addLocalFiles(files: LocalFile[], basePath?: string): Stage {
    this.#changeSets.push({
      changes: files.map((file) => {
        const filePath = basePath ? file.pathWithBase(basePath) : file.path;
        return this.add(filePath, file.data, file.mode);
      }),
    });
    return this;
  }

  public modifyFile(path: string, modifier: ContentModifier);
  public modifyFile(
    predicate: Predicate<TreeObject>,
    modifier: ContentModifier
  );
  public modifyFile(
    predicate: Predicate<TreeObject> | string,
    modifier: ContentModifier
  ): Stage {
    this.#changeSets.push({
      changes: [
        async (changes) => {
          let pred: Predicate<TreeObject>;
          if (isPredicate(predicate)) {
            pred = predicate;
          } else {
            pred = ObjectPredicates.pathEquals(predicate);
          }

          const baseBranch = await this.getBaseBranch();
          const files = await this.#repository.getFilesWithContent(
            baseBranch,
            pred
          );
          if (files.length === 1 && files[0].content) {
            const file = files[0];
            const modified = await modifier(file.content.toString("utf8"));
            return this.modify(
              file.path,
              file.content,
              Buffer.from(modified),
              file.mode
            )(changes);
          } else {
            console.log(`Warning: no file found for modification.`);
          }
        },
      ],
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
    this.#changeSets.push({
      changes: [
        async (changes) => {
          const baseBranch = await this.getBaseBranch();
          const files = await this.#repository.getFilesWithContent(
            baseBranch,
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
    this.#changeSets.push({
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
    this.#changeSets.push({
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

  public async commit(message: string): Promise<CommitCompletion> {
    const baseBranch = await this.getBaseBranch();
    const latestCommit = await this.#repository.getLatestCommitToBranch(
      baseBranch
    );
    const latestTree = await this.#repository.getTree(latestCommit);

    if (latestTree.truncated) {
      throw new Error("Unable to retrieve all objects for current tree");
    }

    const existingChangesState = new ChangeState(
      latestTree.tree
        .filter((t) => t.type !== ObjectType.Tree)
        .reduce((acc, obj) => {
          acc[obj.path] = obj;
          return acc;
        }, {} as ChangeMap)
    );

    const finalChangeState = await this.#changeSets.reduce(
      async (changeStatePromise, changeSet) => {
        const changeState = await changeStatePromise;
        const changeResults = await this.sequence(changeSet.changes)(
          changeState.changeMap
        );

        return changeState.update(changeResults.changes, changeResults.entries);
      },
      Promise.resolve(existingChangesState)
    );

    if (finalChangeState.equals(existingChangesState)) {
      return new CommitCompletion(this.#branch, [], this.isDryRun());
    }

    const ref = await this.createCommit(
      message,
      finalChangeState.toChangeList()
    );

    return new CommitCompletion(
      this.#branch,
      finalChangeState.entries,
      this.isDryRun(),
      ref
    );
  }

  private nochange(changes: ChangeMap): ChangeResult {
    return { changes, entries: [] };
  }

  private add(
    path: string,
    content: Buffer,
    mode: ObjectMode,
    type = ObjectType.Blob
  ): ChangeApplicator {
    return async (changes) => {
      if (path in changes && changes[path].sha === blobSha(content)) {
        return this.nochange(changes);
      }
      const cloned = { ...changes };

      const blob = await this.createBlob(content);
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
      if (path in changes && changes[path].sha === blobSha(destContent)) {
        return this.nochange(changes);
      }

      const cloned = { ...changes };

      const blob = await this.createBlob(destContent);
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
      if (!(path in changes)) {
        return this.nochange(changes);
      }
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
      if (!(src in changes)) {
        return this.nochange(changes);
      }

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

function isPredicate(
  predicate: Predicate<TreeObject> | string
): predicate is Predicate<TreeObject> {
  return !(typeof predicate === "string");
}

function changelog(entry: ChangeEntry): string {
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

class ChangeState {
  readonly #changeMap: ChangeMap;
  readonly #entries: ChangeEntry[];

  constructor(changeMap: ChangeMap, entries: ChangeEntry[] = []) {
    this.#changeMap = changeMap;
    this.#entries = entries;
  }

  get changeMap(): ChangeMap {
    return this.#changeMap;
  }

  get entries(): ChangeEntry[] {
    return this.#entries;
  }

  update(changeMap: ChangeMap, newEntries: ChangeEntry[]): ChangeState {
    return new ChangeState(changeMap, this.entries.concat(newEntries));
  }

  toChangeList(): Change[] {
    return Object.keys(this.#changeMap).map((k) => this.#changeMap[k]);
  }

  equals(that: ChangeState): boolean {
    return Object.is(this.changeMap, that.changeMap);
  }
}

export class CommitCompletion {
  readonly #ref?: Ref;
  readonly #dryRun: boolean;
  readonly #changes: ChangeEntry[];
  readonly #branch: string;

  constructor(
    branch: string,
    changes: ChangeEntry[],
    dryRun = false,
    ref?: Ref
  ) {
    this.#ref = ref;
    this.#dryRun = dryRun;
    this.#branch = branch;
    this.#changes = changes;
  }

  changelog(): string {
    return this.#changes.map(changelog).join("\n");
  }

  hasChanges(): boolean {
    if (this.#ref) {
      return true;
    } else {
      return false;
    }
  }

  get dryRun(): boolean {
    return this.#dryRun;
  }

  get ref(): Ref {
    return this.#ref;
  }

  get branch(): string {
    return this.#branch;
  }
}
