import type { LibraryItem } from "../domain/library-item.js";
import type { LibraryPage } from "../repository/library.repository.js";
import { libraryItemOutputSchema, libraryListOutputSchema } from "./output.js";

export class LibraryDtoAdapter {
  static toOutput(item: LibraryItem) { return libraryItemOutputSchema.parse(item); }
  static toListOutput(page: LibraryPage) { return libraryListOutputSchema.parse({ items: page.items.map(LibraryDtoAdapter.toOutput), nextCursor: page.nextCursor }); }
}
