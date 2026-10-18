import { OwnedEntity } from "../domain/owned-entity.js";
import { BaseRepository } from "../repository/base.repository.js";

export abstract class BaseService<
  TEntity extends OwnedEntity,
  TRepository extends BaseRepository<TEntity>,
> {
  protected constructor(protected readonly repository: TRepository) {}
}
