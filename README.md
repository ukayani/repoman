# Repoman
![Typescript](https://github.com/ukayani/repoman/workflows/Typescript/badge.svg?branch=master)

This is a GitHub client library with a focus on performing bulk operations across several repos.
The aim is to expose multi file commits purely via the [Github Data API](https://docs.github.com/en/rest/reference/git) to remove the need to clone
repositories to disk for bulk operations. 

## Example Use Cases
Some example use cases which this library can be used for are:

- Updating the version of some dependency (package.json, pom.xml, build.gradle) across several repos.
- Adding a `.gitignore` file to multiple repos
- Removing unused files across several repos
- Updating broken links in MarkDown files across several repos 
   
In general, it enables you to quickly set up a multi-repo automation
which makes file modifications, issues a PR, merges and deletes the branch -- all without 
cloning a single file to disk.

## Feature Highlights

- a high level API for making multi-file commits
- output a diff of file changes from a commit
- do a dry run of changes to a repo with a diff output of potential changes
- create and merge pull requests
- use glob patterns to modify files in a git repo
- make changes to files without local clone
- delete branches
- load a list of repositories from a YAML file
- get a list of repositories matching a [GitHub Code Search](https://docs.github.com/en/github/searching-for-information-on-github/searching-code)
- get a list of repositories filtered by attributes such as language, star count, etc.
- save a list of repositories to a YAML file

# Docs

For details on usage and examples visit the docs page:
[Documentation](https://ukayani.github.io/repoman/)

## Installation

```bash
$ npm i @ukayani/repoman --save
```

## Github Token

A GitHub token can be configured via:
- a `GITHUB_TOKEN` environment variable 
- a `config.yaml` file in the working directory with a `token` key
- the constructor of the GitHub class `new GitHub(token)`

## Sample Code

Below is an automation which reads a list of repos from a file
and then removes all Maven Wrapper files from them. It then creates a PR
for each change and optionally merges the PR.

```typescript
import { Config, GitHub } from "@ukayani/repoman";

async function main() {
  const github = await GitHub.init();
  const config = await Config.load("services.yaml");
  const repos = await github.getRepositories(config.repos);
  const automerge = false;

  for (const repo of repos) {
    const result = await repo
      .checkout("maven-wrapper-removal")
      .deleteFile(".mvn")
      .deleteFile("mvnw")
      .deleteFile("mvnw.cmd")
      .commit("Remove maven wrapper");
    console.log(`Changes for ${repo.name}`);
    console.log(result.changelog());

    if (result.hasChanges()) {
      const pr = await repo.createPullRequest(
        result.branch,
        "PR Title",
        "body",
        ["ukayani"]
      );
      if (automerge) {
        await repo.mergePullRequest(pr);
      }
      console.log(pr);
    }
  }
}

main().catch(console.error);

```

