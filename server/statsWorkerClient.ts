import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import {
  buildValidatedAnalysisSpec,
  extractReferencedVariables,
  type AnalysisSpec,
} from "../shared/analysisSpec.ts";
import type { AnalysisResult, Cell, TestName, Variable } from "../src/lib/types.ts";
import {
  buildReproduciblePythonScript,
  buildTsLegacyProvenance,
  computeDatasetSha256,
  computeSpecHash,
} from "./analysisProvenance.ts";
import { logSecurityEvent, redactSensitiveText } from "./logger.ts";
import { runStatTest, StatsError } from "./statsEngine.ts";

export class VerifiedEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifiedEngineUnavailableError";
  }
}

export interface ExecuteAnalysisOptions {
  test: TestName;
  rows: Record<string, Cell>[];
  variables: Variable[];
  params: Record<string, unknown>;
  specOptions?: {
    seed?: number;
    alpha?: number;
    confLevel?: number;
    tieMethod?: "efron" | "breslow";
  };
  requireVerifiedEngine?: boolean;
  pythonBin?: string;
}

export interface ExecutedAnalysisEnvelope {
  spec: AnalysisSpec;
  specHash: string;
  datasetSha256: string;
  result: AnalysisResult;
}

const WORKER_SCRIPT_PATH = path.resolve(process.cwd(), "stats-worker", "runner.py");
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;

let cachedHealth: { checkedAt: number; available: boolean; bin: string | null } | null = null;

function resolvePythonBin(override?: string): string {
  if (override) return override;
  const envBin = (process.env.STATS_PYTHON_BIN ?? "").trim();
  if (envBin) return envBin;
  const venvBin = "/opt/stats-venv/bin/python";
  if (fs.existsSync(venvBin)) return venvBin;
  return "python3";
}

function minimalWorkerEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || "/opt/stats-venv/bin:/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    OPENBLAS_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    MKL_NUM_THREADS: "1",
  };
}

function runPythonSubprocess(
  bin: string,
  args: string[],
  stdinText: string | null,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: path.dirname(WORKER_SCRIPT_PATH),
      env: minimalWorkerEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("WORKER_TIMEOUT"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          reject(new Error("WORKER_OUTPUT_TOO_LARGE"));
        }
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8").slice(0, 4096);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    if (stdinText !== null) {
      child.stdin.write(stdinText, "utf8");
    }
    child.stdin.end();
  });
}

export async function probePythonWorkerHealth(pythonBinOverride?: string): Promise<boolean> {
  if (!fs.existsSync(WORKER_SCRIPT_PATH)) return false;
  const bin = resolvePythonBin(pythonBinOverride);
  const now = Date.now();
  if (!pythonBinOverride && cachedHealth && cachedHealth.bin === bin && now - cachedHealth.checkedAt < 60_000) {
    return cachedHealth.available;
  }

  try {
    const res = await runPythonSubprocess(bin, [WORKER_SCRIPT_PATH, "--health"], null, 5000);
    let ok = false;
    if (res.code === 0 && res.stdout.trim()) {
      const parsed = JSON.parse(res.stdout.trim()) as { ok?: boolean };
      ok = parsed?.ok === true;
    }
    if (!pythonBinOverride) {
      cachedHealth = { checkedAt: now, available: ok, bin };
    }
    return ok;
  } catch {
    if (!pythonBinOverride) {
      cachedHealth = { checkedAt: now, available: false, bin };
    }
    return false;
  }
}

export function resetPythonWorkerHealthCacheForTests(): void {
  cachedHealth = null;
}

function projectMinimalDataForWorker(
  spec: AnalysisSpec,
  variables: Variable[],
  rows: Record<string, Cell>[]
): { variables: Variable[]; rows: Record<string, Cell>[] } {
  if (
    spec.test === "sample_size" ||
    (spec.test === "multiple_testing" && spec.params.mode === "pvalues")
  ) {
    return { variables: [], rows: [] };
  }
  const referenced = extractReferencedVariables(spec);
  if (!referenced.length) {
    if (spec.test === "missing_analysis") {
      const allNames = variables.map((v) => v.name);
      const filteredRows = rows.map((r) => {
        const slim: Record<string, Cell> = {};
        for (const col of allNames) {
          slim[col] = r[col] ?? null;
        }
        return slim;
      });
      return { variables, rows: filteredRows };
    }
    return { variables: [], rows: [] };
  }
  const refSet = new Set(referenced);
  const filteredVars = variables.filter((v) => refSet.has(v.name));
  const filteredRows = rows.map((r) => {
    const slim: Record<string, Cell> = {};
    for (const col of referenced) {
      slim[col] = r[col] ?? null;
    }
    return slim;
  });
  return { variables: filteredVars, rows: filteredRows };
}

export async function executeStatisticalAnalysis(
  input: ExecuteAnalysisOptions
): Promise<ExecutedAnalysisEnvelope> {
  let spec: AnalysisSpec;
  try {
    spec = buildValidatedAnalysisSpec(input.test, input.params, input.specOptions);
  } catch (err) {
    if (err instanceof ZodError) {
      const msg = err.issues.map((i) => i.message).join("; ");
      throw new StatsError(`Especificación estadística no válida: ${msg}`);
    }
    throw err;
  }

  const datasetSha256 = computeDatasetSha256(input.variables, input.rows);
  const specHash = computeSpecHash(spec);
  const requireVerified =
    input.requireVerifiedEngine ??
    ((process.env.REQUIRE_VERIFIED_ENGINE ?? "").trim().toLowerCase() === "true");

  const pythonReady = await probePythonWorkerHealth(input.pythonBin);
  if (pythonReady) {
    const bin = resolvePythonBin(input.pythonBin);
    const projected = projectMinimalDataForWorker(spec, input.variables, input.rows);
    const workerPayload = JSON.stringify({
      spec,
      spec_hash: specHash,
      dataset_sha256: datasetSha256,
      variables: projected.variables,
      rows: projected.rows,
    });

    try {
      const execRes = await runPythonSubprocess(bin, [WORKER_SCRIPT_PATH], workerPayload);
      if (execRes.stdout.trim()) {
        const parsed = JSON.parse(execRes.stdout) as {
          ok: boolean;
          code?: string;
          detail?: string;
          result?: AnalysisResult;
        };
        if (parsed.ok && parsed.result) {
          return {
            spec,
            specHash,
            datasetSha256,
            result: parsed.result,
          };
        }
        if (parsed.code === "STATS_ERROR" || parsed.code === "INVALID_INPUT") {
          throw new StatsError(parsed.detail || "No se pudo completar el cálculo estadístico.");
        }
        if (parsed.code === "UNSUPPORTED_TEST") {
          if (requireVerified) {
            throw new VerifiedEngineUnavailableError(
              `La prueba '${spec.test}' aún no está habilitada en el motor Python verificado.`
            );
          }
          const legacy = runStatTest(input.test, input.rows, input.variables, spec.params as Record<string, unknown>);
          return {
            spec,
            specHash,
            datasetSha256,
            result: {
              ...legacy,
              reproducible_script:
                legacy.reproducible_script ??
                buildReproduciblePythonScript(spec, specHash, datasetSha256),
              provenance: buildTsLegacyProvenance({
                spec,
                datasetSha256,
                specHash,
                extraWarnings: [
                  `La prueba '${spec.test}' utilizó el motor TS de transición en esta fase.`,
                ],
              }),
            },
          };
        }
      }

      logSecurityEvent("warn", "python_worker_runtime_failure", {
        code: execRes.code,
        stderr: redactSensitiveText(execRes.stderr).slice(0, 400),
      });
    } catch (err) {
      if (err instanceof StatsError || err instanceof VerifiedEngineUnavailableError) {
        throw err;
      }
      logSecurityEvent("warn", "python_worker_invocation_error", {
        message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
      });
    }
  }

  if (requireVerified) {
    throw new VerifiedEngineUnavailableError(
      "El motor estadístico Python verificado no está disponible en este entorno (REQUIRE_VERIFIED_ENGINE=true)."
    );
  }

  const legacyResult = runStatTest(
    input.test,
    input.rows,
    input.variables,
    spec.params as Record<string, unknown>
  );
  return {
    spec,
    specHash,
    datasetSha256,
    result: {
      ...legacyResult,
      reproducible_script:
        legacyResult.reproducible_script ??
        buildReproduciblePythonScript(spec, specHash, datasetSha256),
      provenance: buildTsLegacyProvenance({
        spec,
        datasetSha256,
        specHash,
      }),
    },
  };
}
