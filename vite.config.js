import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        storefront: resolve(import.meta.dirname, "index.html"),
        product: resolve(import.meta.dirname, "product.html"),
        admin: resolve(import.meta.dirname, "admin/index.html"),
        adminRedirect: resolve(import.meta.dirname, "admin.html"),
        contact: resolve(import.meta.dirname, "contact/index.html"),
        contactRedirect: resolve(import.meta.dirname, "contact.html"),
        thankYou: resolve(import.meta.dirname, "thank-you.html"),
      },
    },
  },
});
