import * as fs from "fs";
import * as p from "path";
import { promisify } from "util";
import { GitObjectWriter, ObjectMode } from "./repository";
import { Stats } from "fs";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkDir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readDir = promisify(fs.readdir);

function toUnixMode(mode: ObjectMode): number {
  return parseInt(mode, 8) & 0o777;
}

export function toDir(dir: string): GitObjectWriter {
  return async (path, mode, content) => {
    const filePath = p.normalize(p.join(dir, path));
    const fileDir = p.dirname(filePath);
    await mkDir(fileDir, { recursive: true });
    const unixMode = toUnixMode(mode);
    await writeFile(filePath, content, { mode: unixMode });
  };
}

function isExecutable(mode: number): boolean {
  const executableBit = 0b001000000;
  return (mode & executableBit) !== 0;
}

async function getFile(path: string, stats: Stats): Promise<LocalFile> {
  const data = await readFile(path);
  const mode = isExecutable(stats.mode)
    ? ObjectMode.Executable
    : ObjectMode.File;
  return new LocalFile(p.resolve(path), p.normalize(path), data, mode);
}

/**
 * Get a list of files recursively at the given path
 * @param path
 */
export async function getFiles(path: string): Promise<LocalFile[]> {
  const stats = await stat(path);

  if (stats.isFile()) {
    const file = await getFile(path, stats);
    return [file];
  } else if (stats.isDirectory()) {
    const files = await readDir(path);
    const filesPromises = files.reduce((acc, f) => {
      return acc.concat(getFiles(p.join(path, f)));
    }, [] as Array<Promise<LocalFile[]>>);

    return Promise.all(filesPromises).then((files) =>
      files.reduce((acc, localFiles) => acc.concat(localFiles), [])
    );
  }
  return [];
}

export class LocalFile {
  absolutePath: string;
  path: string;
  data: Buffer;
  mode: ObjectMode;

  constructor(
    absolutePath: string,
    path: string,
    data: Buffer,
    mode: ObjectMode
  ) {
    this.absolutePath = absolutePath;
    this.path = path;
    this.data = data;
    this.mode = mode;
  }

  pathWithBase(basePath: string): string {
    return p.join(basePath, this.path);
  }
}
