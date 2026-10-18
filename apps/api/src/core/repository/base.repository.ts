import { OwnedEntity } from "../domain/owned-entity.js";

export abstract class BaseRepository<TEntity extends OwnedEntity> {
  abstract create(entity: TEntity): Promise<TEntity>;
  abstract findById(ownerId: string, id: string): Promise<TEntity | null>;
}
