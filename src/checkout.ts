import { Repository } from "./repository";
import { Stage } from "./stage";

export class Checkout {
  readonly #repository: Repository;
  readonly #branch: string;
  readonly #baseBranch: string;

  constructor(repository: Repository, branch: string, baseBranch = "master") {
    this.#repository = repository;
    this.#branch = branch;
    this.#baseBranch = baseBranch;
  }

  public async stage(): Promise<Stage> {
    const existing = await this.#repository.getBranch(this.#branch);
    const baseBranch = existing !== null ? this.#branch : this.#baseBranch;
    return new Stage(this.#repository, this.#branch, baseBranch);
  }
}
