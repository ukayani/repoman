import {getConfig} from './lib/config';
import {GitHub, GitHubRepository} from './lib/github';
import * as fs from 'fs';
import * as p from 'path';
import {promisify} from 'util';
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkDir = promisify(fs.mkdir);


async function main() {
    const config = await getConfig();
    const github = new GitHub(config);

    const FILE = '100644';
    // commit to branch
    // -> branch name
    // -> message string
    // -> changes: [{sha: string, content: string, path: string}]

    function toDir(dir: string): (path: string, mode: string, content: Buffer) => Promise<void> {
        return async (path, mode, content) => {
            const filePath = p.normalize(p.join(dir, path));
            const fileDir = p.dirname(filePath);
            await mkDir(fileDir, {recursive: true});
            const unixMode = (mode === '100644') ? 0o644: 0o755;
            await writeFile(filePath, content, {mode: unixMode});
        }
    }

    github
        .getRepositories()
        .then(repos => repos.forEach(async r => r.git
            .fetchBranch('master', toDir('./tmp'))

        ))
        .catch(console.error);
}

main().catch(console.error);