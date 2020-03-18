import {getConfig} from './lib/config';
import {GitHub, GitHubRepository, toDir} from './lib/github';

async function main() {
    const config = await getConfig();
    const github = new GitHub(config);

    github
        .getRepositories()
        .then(repos => repos.forEach(async r => r.git
            .getMatchingFilesWithContent('master', 'test/*.spec.js')
            .then(console.log)

        ))
        .catch(console.error);
}

main().catch(console.error);