export abstract class OwnedEntity {
  abstract readonly id: string;
  abstract readonly ownerId: string;
  abstract readonly createdAt: string;
  abstract readonly updatedAt: string;
  abstract readonly version: number;
}
