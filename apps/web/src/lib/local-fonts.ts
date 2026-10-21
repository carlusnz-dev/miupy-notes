// Fontes de licença restrita (ex.: Silvex Editorial, "uso pessoal") ficam em assets/fonts/local/,
// ignorado pelo Git. O glob só enxerga arquivos presentes: num clone sem eles não há registro nem
// requisição, e as variáveis --font-* caem nas fontes livres. Os arquivos originais são usados sem converter.
const files = import.meta.glob("../assets/fonts/local/*.{otf,ttf,woff,woff2}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const weights: Record<string, number> = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900 };

for (const [path, url] of Object.entries(files)) {
  const match = /\/([A-Za-z]+)-(Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)(Italic)?(?:-[^/]*)?\.\w+$/.exec(path);
  if (!match) continue;
  const family = match[1].replace(/([a-z])([A-Z])/g, "$1 $2");
  const face = new FontFace(family, `url("${url}")`, { weight: String(weights[match[2]]), style: match[3] ? "italic" : "normal", display: "swap" });
  document.fonts.add(face);
}
