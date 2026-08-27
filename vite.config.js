import { defineConfig } from "vite";

export default defineConfig({
  appType: "mpa",
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
  plugins: [
    {
      name: "game-alias",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/game" || req.url === "/game/") req.url = "/";
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/game" || req.url === "/game/") req.url = "/";
          next();
        });
      },
    },
  ],
});
