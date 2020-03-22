import * as fs from 'fs';
import * as p from 'path';
import {promisify} from 'util';
import {GitObjectWriter, ObjectMode} from "./repository";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkDir = promisify(fs.mkdir);
const stat = promisify(fs.stat);

function toUnixMode(mode: ObjectMode): number {
    return parseInt(mode, 8) & 0o777;
}

export function toDir(dir: string): GitObjectWriter {
    return async (path, mode, content) => {
        const filePath = p.normalize(p.join(dir, path));
        const fileDir = p.dirname(filePath);
        await mkDir(fileDir, {recursive: true});
        const unixMode = toUnixMode(mode);
        await writeFile(filePath, content, {mode: unixMode});
    }
}

function isExecutable(mode: number): boolean {
    const executableBit = 0b001000000;
    return (mode & executableBit) !== 0;
}

export async function getFile(path: string): Promise<LocalFile> {
    const stats = await stat(path);

    if (stats.isFile()) {
        const data = await readFile(path);
        const mode = isExecutable(stats.mode) ? ObjectMode.Executable: ObjectMode.File;
        return {
            path: p.resolve(path),
            data,
            mode
        };
    } else {
        throw new Error("Path is not a file")
    }
}

export interface LocalFile {
    path: string;
    data: Buffer;
    mode: ObjectMode;
}