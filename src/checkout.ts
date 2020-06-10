import { Repository } from "./repository";
import { Stage } from "./stage";

export class Checkout {
  readonly #repository: Repository;
  readonly #branch: string;
  readonly #startPoint?: string;

  constructor(repository: Repository, branch: string, startPoint?: string) {
    this.#repository = repository;
    this.#branch = branch;
    this.#startPoint = startPoint;
  }

  public async stage(dryRun = false): Promise<Stage> {
    const ref = await this.#repository.getBranch(this.#branch);

    if (ref === null) {
      // create with startPoint
      if (!this.#startPoint) {
        throw new Error("Must set start start point for new branch");
      }
      if (!dryRun) {
        await this.#repository.createBranch(this.#branch, this.#startPoint);
      }
    }

    return new Stage(this.#repository, this.#branch, this.#startPoint, dryRun);
  }
}
