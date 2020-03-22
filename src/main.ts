import {getConfig} from './lib/config';
import {GitHub} from './lib/github';
import {getFile} from "./lib/github/filesystem";

async function main() {
    const config = await getConfig();
    const github = new GitHub(config);

    const testsh = await getFile('./test.sh');

    github
        .getRepositories()
        .then(repos => repos.forEach(async r => r.git
            .stage('master')
            .addFile('exc/other', 'Hi World!')
            .commit('testing files')
            .then(console.log)
        ))
        .catch(console.error);



}

main().catch(console.error);