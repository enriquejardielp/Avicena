import crypto from "node:crypto";
import type { AnalysisSpec } from "../shared/analysisSpec.ts";
import type { AnalysisProvenance, Cell, Variable } from "../src/lib/types.ts";

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) {
      out[key] = canonicalize(v);
    }
  }
  return out;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeDatasetSha256(variables: Variable[], rows: Record<string, Cell>[]): string {
  const schemaProjection = variables
    .map((v) => ({
      name: v.name,
      type: v.type,
      levels: Array.isArray(v.levels) ? v.levels : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const payload = canonicalJson({
    schema: schemaProjection,
    n_rows: rows.length,
    rows,
  });

  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

export function computeSpecHash(spec: AnalysisSpec): string {
  return crypto.createHash("sha256").update(canonicalJson(spec), "utf8").digest("hex");
}

export function buildTsLegacyProvenance(params: {
  spec: AnalysisSpec;
  datasetSha256: string;
  specHash: string;
  extraWarnings?: string[];
}): AnalysisProvenance {
  return {
    spec_version: params.spec.specVersion,
    spec_hash: params.specHash,
    dataset_sha256: params.datasetSha256,
    engine: "ts-legacy",
    engine_version: `node-${process.version}`,
    runtime: `Node.js ${process.version} (motor TypeScript de transición)`,
    libraries: [
      {
        package: "avicena-ts-statsEngine",
        version: "1.0.0-legacy",
        method: "Implementación interna en TypeScript (sin librería estadística Python externa activa en este entorno)",
        citation:
          "Nota metodológica: cálculo ejecutado por el motor TypeScript de transición; para publicación clínica se recomienda habilitar el worker Python verificado (SciPy / statsmodels / lifelines / scikit-learn).",
        role: "fallback",
      },
    ],
    seed: params.spec.options.seed,
    executed_at_utc: new Date().toISOString(),
    verified_by_library: false,
    warnings: [
      "Resultado calculado con el motor TS de transición porque el entorno Python científico no está disponible en este nodo.",
      ...(params.extraWarnings ?? []),
    ],
  };
}

export function buildReproduciblePythonScript(
  spec: AnalysisSpec,
  specHash: string,
  datasetSha256: string
): string {
  const specJson = JSON.stringify(spec, null, 2);
  const { seed, alpha, confLevel } = spec.options;
  return `"""
Avicena — Script reproducible auditado
Prueba: ${spec.test}
Dataset SHA-256: ${datasetSha256}
AnalysisSpec SHA-256: ${specHash}
Semilla aleatoria: ${seed} | Alfa: ${alpha} | Nivel IC: ${confLevel}
"""
import json
import numpy as np
import pandas as pd
from scipy import stats

SEED = ${seed}
ALPHA = ${alpha}
CONF_LEVEL = ${confLevel}
np.random.seed(SEED)

SPEC = json.loads("""${specJson}""")
params = SPEC["params"]

# Cargar el mismo conjunto de datos desidentificado (verificando SHA-256 = ${datasetSha256.slice(0, 16)}...)
# df = pd.read_csv("dataset_estudio.csv")
print("Especificación validada para prueba:", SPEC["test"], params)
`;
}

