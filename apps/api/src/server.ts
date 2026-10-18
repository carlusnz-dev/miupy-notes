import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, "127.0.0.1", () => {
  process.stdout.write(`API local em http://127.0.0.1:${port}\n`);
});
