import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// COOP/COEP requis pour DuckDB-WASM (SharedArrayBuffer / bundles COI)
// et les Web Workers. `credentialless` garde les requêtes same-origin
// (Parquet locaux servis en HTTP Range) fonctionnelles.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    headers: isolationHeaders,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    headers: isolationHeaders,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Bundles WASM / workers natifs : le pré-bundling esbuild casse
    // leurs URL de worker (duckdb-wasm, maplibre-gl-worker).
    exclude: ['@duckdb/duckdb-wasm', 'maplibre-gl'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
});
