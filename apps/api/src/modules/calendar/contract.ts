// Contrato HTTP público da agenda, consumido pelo cliente web. Só pode depender de zod:
// tudo o que entrar aqui vai para o bundle do frontend.
export { calendarEventListOutputSchema, calendarEventOutputSchema, googleStatusOutputSchema, googleSyncOutputSchema,
  type CalendarEventListOutput, type CalendarEventOutput, type GoogleStatusOutput, type GoogleSyncOutput } from "./dto/output.js";
