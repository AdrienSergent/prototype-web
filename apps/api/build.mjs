// Bundle de production : le code partagé (@cir/shared, TypeScript) est inclus, les dépendances npm restent externes.
import { build } from "esbuild";

await build({
  entryPoints: { server: "src/server.ts", worker: "src/worker.ts", migrate: "src/db/migrate.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  plugins: [
    {
      name: "externals",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith("@cir/") ? undefined : { path: args.path, external: true }));
      },
    },
  ],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
console.log("API compilée dans dist/");
