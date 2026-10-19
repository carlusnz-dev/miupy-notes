// Contrato HTTP público das pastas, consumido pelo cliente web. Só pode depender de zod:
// tudo o que entrar aqui vai para o bundle do frontend.
export { folderListOutputSchema, folderOutputSchema, type FolderListOutput, type FolderOutput } from "./dto/output.js";
export { MAX_FOLDER_NAME } from "./dto/input.js";
