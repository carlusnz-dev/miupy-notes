import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { editorStyle, setEditorPreferences, useEditorPreferences, type EditorPreferences } from "./lib/editor-preferences";
import Select from "./components/Select";
import { usePageTitle } from "./lib/use-page-title";
import "./editor.css";
import "./settings.css";

const choices = {
  width: [["narrow", "Estreita"], ["medium", "Média"], ["wide", "Larga"]],
  headingFont: [["serif", "Serif"], ["editorial", "Editorial"], ["sans", "Padrão"]],
  editorFont: [["mono", "Mono"], ["sans", "Sans"], ["serif", "Serif"]],
  colorTheme: [["mono", "Monocromático"], ["contrast", "Contraste"], ["soft", "Suave"]],
  chipStyle: [["outline", "Contorno"], ["filled", "Preenchido"]],
} as const;
function PreferenceSelect<K extends keyof typeof choices>({ field, label, value }: { field: K; label: string; value: EditorPreferences[K] }) {
  const options = choices[field].map(([key, text]) => ({ value: key as string, label: text }));
  return <Select label={label} value={value as string} options={options} onChange={(next) => setEditorPreferences({ [field]: next })} />;
}
export default function SettingsPage() {
  usePageTitle("Configurações");
  const p = useEditorPreferences();
  return <div className="settings-page" style={editorStyle(p)}>
    <div className="eyebrow">PREFERÊNCIAS</div><h1>Configurações<em>.</em></h1><p className="lead">Ajuste a leitura e a escrita das suas notas.</p>
    <div className="settings-grid"><section className="settings-panel" aria-label="Preferências do editor">
      <PreferenceSelect field="width" label="Largura do Markdown" value={p.width} />
      <label>Margem interna: {p.padding}px<input type="range" min="12" max="64" step="4" value={p.padding} onChange={(event) => setEditorPreferences({ padding: Number(event.target.value) })} /></label>
      <PreferenceSelect field="headingFont" label="Fonte dos títulos" value={p.headingFont} />
      <PreferenceSelect field="editorFont" label="Fonte do editor" value={p.editorFont} />
      <label>Tamanho do texto: {p.fontSize}px<input type="range" min="12" max="24" value={p.fontSize} onChange={(event) => setEditorPreferences({ fontSize: Number(event.target.value) })} /></label>
      <PreferenceSelect field="colorTheme" label="Cores do editor" value={p.colorTheme} />
      <PreferenceSelect field="chipStyle" label="Estilo das tags" value={p.chipStyle} />
      <label className="settings-check"><input type="checkbox" checked={p.showTags} onChange={(event) => setEditorPreferences({ showTags: event.target.checked })} /> Mostrar tags no editor</label>
    </section><section className={`settings-sample editor-theme-${p.colorTheme} chip-${p.chipStyle}`} aria-label="Prévia ao vivo"><h2>Prévia ao vivo</h2><div className="settings-sample-body markdown-preview"><ReactMarkdown>{"# Uma nota\n\nUm trecho de **texto** para ler com calma.\n\n## Próximo título\n\n- Uma ideia\n- Outra ideia"}</ReactMarkdown>{p.showTags && <span className="editor-chip">exemplo</span>}</div><p className="settings-editor-line" style={{ fontFamily: "var(--editor-font)", fontSize: "var(--editor-size)" }}>Texto no editor em Markdown…</p></section></div>
    <Link className="text-link" to="/notes">Voltar às notas</Link>
  </div>;
}
