// Contrato HTTP público das notas, consumido pelo cliente web. Só pode depender de zod:
// tudo o que entrar aqui vai para o bundle do frontend.
export { noteListOutputSchema, noteOutputSchema, type NoteListOutput, type NoteOutput } from "./dto/output.js";
export { noteMetadataOutputSchema, noteMetadataListOutputSchema, noteSummaryOutputSchema,
  type NoteMetadataOutput, type NoteMetadataListOutput, type NoteSummaryOutput } from "./dto/output.js";
