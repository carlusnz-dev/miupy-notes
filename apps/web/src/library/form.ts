export type LibraryField = "title" | "creator" | "year" | "rating" | "dates" | "tags" | "comment" | "externalUrl" | "coverUrl";
export type LibraryFormValues = {
  title: string; creator: string; year: string; rating: string; tags: string; comment: string;
  externalUrl: string; coverUrl: string; startedOn: string; finishedOn: string;
};
export type LibraryFormErrors = Partial<Record<LibraryField, string>>;

/** Ordem do formulário: o foco vai para o primeiro campo inválido nesta ordem. */
export const fieldOrder: readonly LibraryField[] = ["title", "creator", "year", "rating", "dates", "tags", "comment", "externalUrl", "coverUrl"];

const isHttpUrl = (text: string) => { try { return /^https?:$/.test(new URL(text).protocol); } catch { return false; } };

/** Espelha os limites do dto da API (`dto/input.ts`) para dar erro inline antes do envio. */
export function validateLibraryForm(values: LibraryFormValues): LibraryFormErrors {
  const errors: LibraryFormErrors = {};
  const title = values.title.trim();
  if (!title) errors.title = "Informe o título da obra.";
  else if (title.length > 200) errors.title = "O título aceita até 200 caracteres.";
  if (values.creator.trim().length > 200) errors.creator = "Use até 200 caracteres.";
  if (values.year.trim()) {
    const year = Number(values.year);
    if (!Number.isInteger(year) || year < 1 || year > 9999) errors.year = "Informe um ano inteiro entre 1 e 9999.";
  }
  if (values.rating.trim()) {
    const rating = Number(values.rating);
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) errors.rating = "A nota vai de 0 a 5.";
  }
  if (values.startedOn && values.finishedOn && values.startedOn > values.finishedOn) errors.dates = "A data de fim deve ser igual ou posterior ao início.";
  const tags = values.tags.split(",").map(tag => tag.trim()).filter(Boolean);
  if (tags.length > 20) errors.tags = "Use no máximo 20 tags.";
  else if (tags.some(tag => tag.length > 40)) errors.tags = "Cada tag aceita até 40 caracteres.";
  if (values.comment.trim().length > 1000) errors.comment = "O comentário aceita até 1000 caracteres.";
  for (const field of ["externalUrl", "coverUrl"] as const) {
    const url = values[field].trim();
    if (!url) continue;
    if (!isHttpUrl(url)) errors[field] = "Informe um endereço que comece com http:// ou https://.";
    else if (url.length > 2048) errors[field] = "O endereço aceita até 2048 caracteres.";
  }
  return errors;
}

export const firstInvalid = (errors: LibraryFormErrors) => fieldOrder.find(field => errors[field]);
