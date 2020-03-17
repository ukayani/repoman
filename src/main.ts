import {getConfig} from './lib/config';
import {GitHub, GitHubRepository} from './lib/github';

async function main() {
    const config = await getConfig();
    const github = new GitHub(config);

    const FILE = '100644';
    // commit to branch
    // -> branch name
    // -> message string
    // -> changes: [{sha: string, content: string, path: string}]

    github
        .getRepositories()
        .then(repos => repos.forEach(r => r.git
            .stage('master')
            .moveFile('folder/next.txt', 'folder/next_new.txt')
            .commit('A nice commit message here')
        ))
        .catch(console.error);
}

main().catch(console.error);