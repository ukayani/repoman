import {getConfig} from './lib/config';
import {GitHub} from './lib/github';
import {ObjectMode} from "./lib/github/repository";

async function main() {
    const config = await getConfig();
    const github = new GitHub(config);

    github
        .getRepositories()
        .then(repos => repos.forEach(async r => r.git
            .stage('master')
            .addFile('new/test.txt', 'hello world')
            .commit('testing impl')
            .then(console.log)
        ))
        .catch(console.error);
}

main().catch(console.error);