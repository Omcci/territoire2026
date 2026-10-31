/**
 * Service main-thread : pilote le worker DuckDB-WASM dédié
 * (src/workers/duckdb.worker.ts) via RPC typé, sans `any`.
 */
import {
  type CommuneHistoryRow,
  type CommuneProfile,
  type Indicator,
  type MetricsMap,
  type Scenario,
  type WorkerRequest,
  type WorkerResponse,
} from './metricsTypes';

type Pending =
  | { type: 'init'; resolve: (ms: number) => void; reject: (err: Error) => void }
  | {
      type: 'queryMetrics';
      resolve: (v: { metrics: MetricsMap; elapsedMs: number }) => void;
      reject: (err: Error) => void;
    }
  | {
      type: 'getCommuneHistory';
      resolve: (v: { rows: CommuneHistoryRow[]; elapsedMs: number }) => void;
      reject: (err: Error) => void;
    }
  | {
      type: 'getCommuneProfile';
      resolve: (v: { profile: CommuneProfile | null; elapsedMs: number }) => void;
      reject: (err: Error) => void;
    };

class DuckDBService {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private initPromise: Promise<number> | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../workers/duckdb.worker.ts', import.meta.url), {
      type: 'module',
      name: 'territoires-duckdb',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (!response.ok) {
        pending.reject(new Error(response.error));
        return;
      }
      if (response.type === 'init' && pending.type === 'init') {
        pending.resolve(response.elapsedMs);
      } else if (response.type === 'queryMetrics' && pending.type === 'queryMetrics') {
        const metrics: MetricsMap = new Map();
        for (let i = 0; i < response.codes.length; i += 1) {
          const code = response.codes[i];
          if (!code) continue;
          metrics.set(code, {
            composite: response.composite[i] ?? 0,
            hazard: response.hazard[i] ?? 0,
          });
        }
        pending.resolve({ metrics, elapsedMs: response.elapsedMs });
      } else if (response.type === 'getCommuneHistory' && pending.type === 'getCommuneHistory') {
        pending.resolve({ rows: response.rows, elapsedMs: response.elapsedMs });
      } else if (response.type === 'getCommuneProfile' && pending.type === 'getCommuneProfile') {
        pending.resolve({ profile: response.profile, elapsedMs: response.elapsedMs });
      } else {
        pending.reject(new Error(`Réponse worker incohérente: ${response.type} vs ${pending.type}`));
      }
    };
    worker.onerror = (event: ErrorEvent): void => {
      const err = new Error(event.message || 'Erreur du worker DuckDB');
      for (const pending of this.pending.values()) pending.reject(err);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private post(request: WorkerRequest, pending: Pending): void {
    this.ensureWorker();
    this.pending.set(request.id, pending);
    this.worker?.postMessage(request);
  }

  init(): Promise<number> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise<number>((resolve, reject) => {
      const id = (this.seq += 1);
      this.post(
        { id, type: 'init', payload: { origin: window.location.origin } },
        { type: 'init', resolve, reject },
      );
    });
    return this.initPromise;
  }

  async queryMetrics(
    scenario: Scenario,
    indicator: Indicator,
    year: number,
  ): Promise<{ metrics: MetricsMap; elapsedMs: number }> {
    await this.init();
    return new Promise((resolve, reject) => {
      const id = (this.seq += 1);
      this.post(
        { id, type: 'queryMetrics', payload: { scenario, indicator, year } },
        { type: 'queryMetrics', resolve, reject },
      );
    });
  }

  async getCommuneHistory(codeInsee: string): Promise<{ rows: CommuneHistoryRow[]; elapsedMs: number }> {
    await this.init();
    return new Promise((resolve, reject) => {
      const id = (this.seq += 1);
      this.post(
        { id, type: 'getCommuneHistory', payload: { codeInsee } },
        { type: 'getCommuneHistory', resolve, reject },
      );
    });
  }

  async getCommuneProfile(
    codeInsee: string,
  ): Promise<{ profile: CommuneProfile | null; elapsedMs: number }> {
    await this.init();
    return new Promise((resolve, reject) => {
      const id = (this.seq += 1);
      this.post(
        { id, type: 'getCommuneProfile', payload: { codeInsee } },
        { type: 'getCommuneProfile', resolve, reject },
      );
    });
  }
}

export const duckdbService = new DuckDBService();
