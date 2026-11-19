// Serves the real frontend with a stand-in for the Electron preload bridge.
// Engine requests go through /__engine, which adds the per-run bearer token
// and strips Origin, as Electron's main process does.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import base from "../../../../frontend/vite.config.ts";

const shim = fileURLToPath(new URL("./shim.js", import.meta.url));
const enginePort = process.env.APEX_VERIFY_ENGINE_PORT;
const token = process.env.APEX_VERIFY_TOKEN;
const uiPort = Number(process.env.APEX_VERIFY_UI_PORT ?? 5174);
if (!enginePort || !token) throw new Error("start this through apex-verify up");

export default async (env) => {
  const config = typeof base === "function" ? await base(env) : base;
  return {
    ...config,
    root: fileURLToPath(new URL("../../../../frontend", import.meta.url)),
    plugins: [
      ...config.plugins,
      {
        name: "apex-verify-bridge",
        configureServer(server) {
          server.middlewares.use("/__apex-verify/shim.js", (_req, res) => {
            res.setHeader("Content-Type", "text/javascript");
            res.end(readFileSync(shim));
          });
        },
        transformIndexHtml(html) {
          return html.replace(
            "<head>",
            '<head><script src="/__apex-verify/shim.js"></script>',
          );
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: uiPort,
      strictPort: true,
      hmr: false,
      proxy: {
        "/__engine": {
          target: `http://127.0.0.1:${enginePort}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/__engine/, ""),
          configure: (proxy) =>
            proxy.on("proxyReq", (req) => {
              req.removeHeader("origin");
              req.removeHeader("referer");
              req.setHeader("Authorization", `Bearer ${token}`);
            }),
        },
      },
    },
  };
};
