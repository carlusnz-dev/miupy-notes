import { OwnedEntity } from "../../../core/domain/owned-entity.js";
import type { LibraryItemOutput } from "../dto/output.js";

export class LibraryItem extends OwnedEntity {
  readonly id: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly kind: LibraryItemOutput["kind"];
  readonly title: string;
  readonly creator: string;
  readonly year: number | null;
  readonly status: LibraryItemOutput["status"];
  readonly rating: number | null;
  readonly tags: string[];
  readonly startedOn: string | null;
  readonly finishedOn: string | null;
  readonly comment: string;
  readonly externalUrl: string | null;
  readonly coverUrl: string | null;

  constructor(ownerId: string, data: LibraryItemOutput) {
    super();
    this.ownerId = ownerId;
    this.id = data.id; this.createdAt = data.createdAt; this.updatedAt = data.updatedAt; this.version = data.version;
    this.kind = data.kind; this.title = data.title; this.creator = data.creator; this.year = data.year;
    this.status = data.status; this.rating = data.rating; this.tags = data.tags;
    this.startedOn = data.startedOn; this.finishedOn = data.finishedOn; this.comment = data.comment;
    this.externalUrl = data.externalUrl; this.coverUrl = data.coverUrl;
  }
}
