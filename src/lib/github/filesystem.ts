import * as fs from 'fs';
import * as p from 'path';
import {promisify} from 'util';
import {GitObjectWriter, ObjectMode} from "./repository";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkDir = promisify(fs.mkdir);

function toUnixMode(mode: ObjectMode) {
    if (mode === ObjectMode.File) {
        return 0o644;
    }

    if (mode === ObjectMode.Executable) {
        return 0o755;
    }

    throw new Error("unsupported object mode");
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
