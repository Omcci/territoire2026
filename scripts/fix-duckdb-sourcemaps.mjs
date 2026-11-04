/**
 * Le package @duckdb/duckdb-wasm référence un fichier source map absent
 * (duckdb-browser-mvp.worker.js.map), ce qui fait échouer Vite en dev
 * avec un warning ENOENT à chaque démarrage. Ce script postinstall
 * dépose une source map vide valide à l'emplacement attendu.
 * Idempotent : ne touche à rien si le fichier existe déjà.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
if (!existsSync(dist)) process.exit(0);

const EMPTY_MAP = JSON.stringify({ version: 3, sources: [], names: [], mappings: '' });

for (const file of readdirSync(dist)) {
  if (!file.endsWith('.js')) continue;
  const content = readFileSync(join(dist, file), 'utf8');
  const match = content.match(/sourceMappingURL=([^\s]+)/);
  const mapName = match?.[1];
  if (!mapName || mapName.startsWith('data:')) continue;
  const mapPath = join(dist, mapName);
  if (!existsSync(mapPath)) {
    writeFileSync(mapPath, EMPTY_MAP);
    console.log(`[fix-duckdb-sourcemaps] source map manquante créée : ${mapName}`);
  }
}
