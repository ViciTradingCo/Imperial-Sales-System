import { defineConfig } from 'vite';

// GitHub Pages serves a project site under /<repo>/. Relative base keeps asset
// URLs correct there AND on a custom domain or local preview. Routing is
// hash-based (see src/lib/router.js) so there is no server-rewrite requirement
// and no 404.html fallback dance.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
