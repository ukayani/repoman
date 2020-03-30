import {getConfig} from './lib/config';
import {GitHub} from './lib/github';
import {getFiles} from "./lib/github/filesystem";

async function main() {
    const config = await getConfig();
    const github = new GitHub(config);

    //const mvn = await getFiles('./.mvn');

    // repo
    // .checkout('master', start_point?) -> if branch doesn't exist, creates one pointing to head ref of start_point, otherwise gets head ref of existing
    // <now in branch mode>
    // .stage()
    // <enter stage mode>
    // .. add files
    // .commit(message)
    // <exit stage mode>
    // .stage()
    // <enter stage mode>
    // .. add files
    // .commit(message)
    // <exit stage mode>
    // .pullRequest()
    // <enter PR mode>
    // .withTitle(title)
    // .withDesc(desc)
    // .withReviewers
    // .withLabels
    // .create()
    // <exit PR mode>


    github
        .getRepositories()
        .then(repos => repos.forEach(async r => r
            .checkout("testing-branch")
            .stage()
            .then(console.log)
        ))
        .catch(console.error);

    // mvn.forEach(p => {
    //     console.log('--------------');
    //     console.log(p.path);
    // });

}

main().catch(console.error);