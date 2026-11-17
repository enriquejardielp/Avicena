import { useEffect, useRef, useState } from "react";
import { Download, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, errMsg } from "../../lib/api.ts";
import { VAR_LABEL, type Dataset, type DatasetPage, type VarType } from "../../lib/types.ts";

const VAR_TYPES: VarType[] = ["numeric", "categorical", "binary", "date", "text"];

interface DataTabProps {
  projectId: string;
  datasets: Dataset[];
  activeDatasetId: string;
  onSelectDataset: (id: string) => void;
  onDatasetsChanged: () => void;
  canEdit: boolean;
}

export function DataTab({
  projectId,
  datasets,
  activeDatasetId,
  onSelectDataset,
  onDatasetsChanged,
  canEdit,
}: DataTabProps) {
  const [page, setPage] = useState<DatasetPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const limit = 30;

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setOffset(0);
    setSearch("");
    setDebouncedSearch("");
  }, [activeDatasetId]);

  const loadPage = async () => {
    if (!activeDatasetId) {
      setPage(null);
      return;
    }
    setLoading(true);
    try {
      const q = debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : "";
      const res = await apiGet<DatasetPage>(`/datasets/${activeDatasetId}?offset=${offset}&limit=${limit}${q}`);
      setPage(res);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cargar la sábana de datos."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDatasetId, offset, debouncedSearch]);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || "");
          const idx = res.indexOf(",");
          resolve(idx >= 0 ? res.slice(idx + 1) : res);
        };
        reader.onerror = () => reject(new Error("Error al leer el archivo local."));
        reader.readAsDataURL(file);
      });

      const created = await apiPost<Dataset>(`/projects/${projectId}/datasets/upload`, {
        filename: file.name,
        contentBase64: base64,
      });
      toast.success(`Base «${created.name}» importada (${created.n_rows} registros).`);
      onDatasetsChanged();
      onSelectDataset(created.id);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo importar el archivo CSV/Excel."));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleChangeVarType = async (varName: string, newType: VarType) => {
    if (!activeDatasetId) return;
    try {
      await apiPatch<Dataset>(`/datasets/${activeDatasetId}/variables/${encodeURIComponent(varName)}`, {
        type: newType,
      });
      toast.success(`Variable «${varName}» actualizada a ${VAR_LABEL[newType]}.`);
      await loadPage();
      onDatasetsChanged();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cambiar el tipo de variable."));
    }
  };

  const handleExportCsv = async () => {
    if (!page) return;
    try {
      const safe = page.dataset.name.replace(/[^a-zA-Z0-9_-]+/g, "_");
      await apiDownload(`/datasets/${page.dataset.id}/export`, `${safe}.csv`);
      toast.success("Archivo CSV descargado.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo exportar el CSV."));
    }
  };

  const handleDeleteDataset = async () => {
    if (!page) return;
    try {
      await apiDelete(`/datasets/${page.dataset.id}`);
      toast.success(`Base «${page.dataset.name}» eliminada.`);
      onDatasetsChanged();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo eliminar la base de datos."));
    }
  };

  const activeDs = page?.dataset ?? datasets.find((d) => d.id === activeDatasetId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          {datasets.length > 0 && (
            <select
              aria-label="Seleccionar base de datos"
              value={activeDatasetId}
              onChange={(e) => onSelectDataset(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              data-testid="dataset-selector"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} (N={d.n_rows})
                </option>
              ))}
            </select>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar registros…"
              className="w-56 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              data-testid="dataset-search"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileUpload(f);
            }}
            data-testid="upload-file-input"
          />

          {canEdit && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-600"
              data-testid="upload-dataset-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Importando…" : "Importar CSV / Excel"}
            </button>
          )}

          {activeDs && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              data-testid="export-csv-btn"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </button>
          )}

          {canEdit && activeDs && !activeDs.form_id && (
            <button
              type="button"
              onClick={handleDeleteDataset}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-950/30"
              data-testid="delete-dataset-btn"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </button>
          )}
        </div>
      </div>

      {!activeDs ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Este estudio todavía no tiene bases de datos cargadas.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Importa un archivo CSV o Excel (.xlsx) o crea un formulario clínico CRF para empezar.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>
              Mostrando{" "}
              <strong className="font-mono tabular-nums text-slate-900 dark:text-white">
                {page ? `${Math.min(page.total, offset + 1)}–${Math.min(page.total, offset + page.rows.length)}` : "0"}
              </strong>{" "}
              de <strong className="font-mono tabular-nums text-slate-900 dark:text-white">{page?.total ?? 0}</strong> registros ·{" "}
              <strong className="font-mono tabular-nums text-slate-900 dark:text-white">{activeDs.variables.length}</strong> variables
            </span>
            <span>Ajusta el tipo estadístico de cada columna directamente en la cabecera</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 dark:border-slate-800 dark:bg-slate-800/60">
                  <th className="px-3 py-2.5 text-left font-mono text-[11px] font-semibold text-slate-400">#</th>
                  {activeDs.variables.map((v) => (
                    <th key={v.name} className="min-w-[130px] px-3 py-2.5 text-left align-top">
                      <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{v.name}</div>
                      {v.label && (
                        <div className="truncate text-[11px] font-normal text-slate-500 dark:text-slate-400">{v.label}</div>
                      )}
                      <div className="mt-1">
                        {canEdit ? (
                          <select
                            aria-label={`Tipo de variable ${v.name}`}
                            value={v.type}
                            onChange={(e) => handleChangeVarType(v.name, e.target.value as VarType)}
                            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                            data-testid={`vartype-${v.name}`}
                          >
                            {VAR_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {VAR_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">{VAR_LABEL[v.type]}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {loading && !page ? (
                  <tr>
                    <td colSpan={activeDs.variables.length + 1} className="px-4 py-10 text-center text-slate-500">
                      Cargando matriz de datos…
                    </td>
                  </tr>
                ) : !page?.rows.length ? (
                  <tr>
                    <td colSpan={activeDs.variables.length + 1} className="px-4 py-10 text-center text-slate-500">
                      No hay registros que coincidan con el filtro.
                    </td>
                  </tr>
                ) : (
                  page.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-400">{offset + idx + 1}</td>
                      {activeDs.variables.map((v) => {
                        const val = row[v.name];
                        const isMissing = val === null || val === undefined || val === "";
                        const isNum = v.type === "numeric" && typeof val === "number";
                        return (
                          <td
                            key={v.name}
                            className={`px-3 py-2 whitespace-nowrap ${
                              isNum ? "font-mono tabular-nums text-slate-900 dark:text-slate-100" : "text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {isMissing ? (
                              <span className="rounded bg-amber-100/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                Perdido
                              </span>
                            ) : (
                              String(val)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {page && page.total > limit && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Anterior
              </button>
              <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                Página {Math.floor(offset / limit) + 1} de {Math.ceil(page.total / limit)}
              </span>
              <button
                type="button"
                disabled={offset + limit >= page.total}
                onClick={() => setOffset(offset + limit)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
