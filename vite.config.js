import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        storefront: resolve(import.meta.dirname, "index.html"),
        product: resolve(import.meta.dirname, "product.html"),
        admin: resolve(import.meta.dirname, "admin.html"),
      },
    },
  },
});
