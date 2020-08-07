---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults

layout: home
nav_order: 1
---

# Introduction

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

## Installation

```bash
$ npm i @ukayani/repoman --save
```

## Sample Code

