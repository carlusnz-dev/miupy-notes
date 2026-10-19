import { OwnedEntity } from "../../../core/domain/owned-entity.js";

export class Folder extends OwnedEntity {
  constructor(
    public readonly id: string,
    public readonly ownerId: string,
    public readonly name: string,
    public readonly parentId: string | null,
    public readonly createdAt: string,
    public readonly updatedAt: string,
    public readonly version: number,
  ) { super(); }
}
