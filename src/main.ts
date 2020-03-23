import {getConfig} from './lib/config';
import {GitHub} from './lib/github';
import {getFiles} from "./lib/github/filesystem";

async function main() {
    const config = await getConfig();
    const github = new GitHub(config);

    const mvn = await getFiles('./.mvn');

    github
        .getRepositories()
        .then(repos => repos.forEach(async r => r.git
            .stage('master')
            .addLocalFiles(mvn)
            .commit('adding .mvn update')
            .then(console.log)
        ))
        .catch(console.error);

    // mvn.forEach(p => {
    //     console.log('--------------');
    //     console.log(p.path);
    // });

}

main().catch(console.error);