import type { LibraryItem } from "../lib/library-api";
export const kinds = [{ value: "book", label: "Livros" }, { value: "film", label: "Filmes" }, { value: "music", label: "Músicas" }] as const;
export const kindLabel = { book: "Livro", film: "Filme", music: "Música" };
export const statuses = [{ value: "wanted", label: "Quero conhecer" }, { value: "in_progress", label: "Em andamento" }, { value: "completed", label: "Concluído" }, { value: "abandoned", label: "Abandonado" }] as const;
export const statusLabel = (status: LibraryItem["status"]) => statuses.find(option => option.value === status)!.label;
