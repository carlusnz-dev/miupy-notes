import { OwnedEntity } from "../../../core/domain/owned-entity.js";

export class Note extends OwnedEntity {
  constructor(
    public readonly id: string,
    public readonly ownerId: string,
    public readonly title: string,
    public readonly body: string,
    public readonly tags: string[],
    public readonly createdAt: string,
    public readonly updatedAt: string,
    public readonly version: number,
  ) { super(); }
}
