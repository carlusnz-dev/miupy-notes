import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Nota formatada, sem edição. Fica em chunk próprio: só carrega ao entrar no modo leitura. */
export default function NoteReading({ body }: { body: string }) {
  return (
    <article className="markdown-preview note-reading" aria-label="Nota em modo leitura" tabIndex={0}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{body}</ReactMarkdown>
    </article>
  );
}
