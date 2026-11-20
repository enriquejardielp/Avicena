import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  Download,
  FilePlus2,
  Lock,
  Pencil,
  PieChart,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import {
  cleanRecordInput,
  createFormFromDataset,
  deleteDataset,
  exportDatasetControlled,
  getDatasetWithRows,
  getForm,
  updateDatasetRow,
  updateDatasetVariableType,
  uploadDataset,
} from "../../lib/firestoreDb.ts";
import { Link } from "../../lib/router.tsx";
import {
  CRF_STATUS_LABEL,
  VAR_LABEL,
  type Cell,
  type CrfRecordStatus,
  type Dataset,
  type DatasetRowItem,
  type Form,
  type Role,
  type VarType,
} from "../../lib/types.ts";
import { FieldInput } from "../forms/FieldInput.tsx";

const VAR_TYPES: VarType[] = ["numeric", "ordinal", "categorical", "binary", "date", "text"];

const STATUS_BADGE: Record<CrfRecordStatus, string> = {
  borrador: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  completado: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  enviado: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  verificado: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  bloqueado: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

interface DataTabProps {
  projectId: string;
  projectOwnerId: string;
  datasets: Dataset[];
  activeDatasetId: string;
  onSelectDataset: (id: string) => void;
  onDatasetsChanged: () => void;
  canEdit: boolean;
  canExport: boolean;
  myRole?: Role;
  refreshSignal?: number;
  onOpenSampleDashboard?: () => void;
}

export function DataTab({
  projectId,
  projectOwnerId,
  datasets,
  activeDatasetId,
  onSelectDataset,
  onDatasetsChanged,
  canEdit,
  canExport,
  myRole,
  refreshSignal = 0,
  onOpenSampleDashboard,
}: DataTabProps) {
  const { user } = useAuth();
  const [loadedDataset, setLoadedDataset] = useState<Dataset | null>(null);
  const [allRowItems, setAllRowItems] = useState<DatasetRowItem[]>([]);
  const [linkedForm, setLinkedForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creatingForm, setCreatingForm] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<{
    identifierColumns: string[];
    piiWarnings: string[];
  } | null>(null);
  const [recentUploadInfo, setRecentUploadInfo] = useState<{ name: string; rows: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const limit = 30;

  // Row edit modal state
  const [editingRow, setEditingRow] = useState<DatasetRowItem | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [editReason, setEditReason] = useState("");
  const [savingRow, setSavingRow] = useState(false);

  // Controlled CSV export modal state
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportReason, setExportReason] = useState("");
  const [includeIdentifiers, setIncludeIdentifiers] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastExportReport, setLastExportReport] = useState<{
    sha256: string;
    strippedColumns: string[];
    rowCount: number;
  } | null>(null);

  const canIncludeRawIdentifiers = myRole === "admin" || myRole === "coordinador";

  const selectedDatasetMeta = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 220);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setOffset(0);
    setSearch("");
    setDebouncedSearch("");
    setEditingRow(null);
    setLastExportReport(null);
  }, [activeDatasetId]);

  const loadDatasetData = async () => {
    if (!selectedDatasetMeta) {
      setLoadedDataset(null);
      setAllRowItems([]);
      setLinkedForm(null);
      return;
    }
    setLoading(true);
    try {
      const [res, formRes] = await Promise.all([
        getDatasetWithRows(projectId, selectedDatasetMeta),
        selectedDatasetMeta.form_id ? getForm(projectId, selectedDatasetMeta.form_id).catch(() => null) : Promise.resolve(null),
      ]);
      setLoadedDataset(res.dataset);
      setAllRowItems(res.rowItems);
      setLinkedForm(formRes);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cargar la sábana de datos."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDatasetData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activeDatasetId, selectedDatasetMeta?.n_rows, refreshSignal]);

  const filteredItems = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return allRowItems;
    return allRowItems.filter(
      (item) =>
        (item.subject_pseudo_id && item.subject_pseudo_id.toLowerCase().includes(q)) ||
        Object.values(item.data).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
    );
  }, [allRowItems, debouncedSearch]);

  const pagedItems = useMemo(
    () => filteredItems.slice(offset, offset + limit),
    [filteredItems, offset]
  );

  const handleFileUpload = async (file: File) => {
    if (!user) return;
    setUploading(true);
    setUploadWarnings(null);
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

      const created = await uploadDataset(projectId, projectOwnerId, file.name, base64, user);
      const idCols = created.identifier_columns ?? [];
      const piiWarns = created.pii_warnings ?? [];
      if (idCols.length > 0 || piiWarns.length > 0) {
        setUploadWarnings({ identifierColumns: idCols, piiWarnings: piiWarns });
        toast.warning(
          "Aviso de privacidad: se detectaron posibles columnas o valores identificativos en el archivo importado."
        );
      }

      if (created.auto_form) {
        toast.success(
          `Base «${created.name}» importada (${created.n_rows} registros) y formulario CRF creado automáticamente.`
        );
      } else {
        toast.success(`Base «${created.name}» importada (${created.n_rows} registros).`);
      }
      setRecentUploadInfo({ name: created.name, rows: created.n_rows });
      onDatasetsChanged();
      onSelectDataset(created.id);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo importar el archivo CSV/Excel."));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCreateFormFromDataset = async () => {
    const targetDs = loadedDataset ?? selectedDatasetMeta;
    if (!targetDs || !user) return;
    setCreatingForm(true);
    try {
      const form = await createFormFromDataset(projectId, projectOwnerId, targetDs, user);
      toast.success(`Formulario CRF «${form.name}» creado y vinculado a esta base.`);
      onDatasetsChanged();
      await loadDatasetData();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo generar el formulario desde la base."));
    } finally {
      setCreatingForm(false);
    }
  };

  const handleChangeVarType = async (varName: string, newType: VarType) => {
    const targetDs = loadedDataset ?? selectedDatasetMeta;
    if (!targetDs || !user) return;
    try {
      const updated = await updateDatasetVariableType(projectId, targetDs, varName, newType, user);
      setLoadedDataset(updated);
      toast.success(`Variable «${varName}» actualizada a ${VAR_LABEL[newType]}.`);
      onDatasetsChanged();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cambiar el tipo de variable."));
    }
  };

  const handleControlledExport = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetDs = loadedDataset ?? selectedDatasetMeta;
    if (!targetDs || !canExport) return;
    if (exportReason.trim().length < 10) {
      toast.error("Indica el motivo clínico o analítico de la exportación (mínimo 10 caracteres).");
      return;
    }
    setExporting(true);
    try {
      const res = await exportDatasetControlled(
        projectId,
        targetDs,
        allRowItems.map((it) => it.data),
        exportReason.trim(),
        canIncludeRawIdentifiers ? includeIdentifiers : false
      );
      const blob = new Blob([res.csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setLastExportReport({
        sha256: res.sha256,
        strippedColumns: res.strippedColumns,
        rowCount: res.rowCount,
      });
      setExportModalOpen(false);
      setExportReason("");
      setIncludeIdentifiers(false);
      toast.success(`Exportación auditada (${res.rowCount} filas · SHA-256 ${res.sha256.slice(0, 12)}…).`);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo completar la exportación controlada."));
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteDataset = async () => {
    const targetDs = loadedDataset ?? selectedDatasetMeta;
    if (!targetDs || !user) return;
    try {
      await deleteDataset(projectId, targetDs, user);
      toast.success(`Base «${targetDs.name}» eliminada.`);
      onDatasetsChanged();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo eliminar la base de datos."));
    }
  };

  const openEditModal = (item: DatasetRowItem) => {
    if (item.source === "crf" && (item.status === "verificado" || item.status === "bloqueado")) {
      toast.error(
        `El registro está en estado «${CRF_STATUS_LABEL[item.status]}». Un Coordinador o IP debe reabrirlo primero desde el CRF.`
      );
      return;
    }
    setEditingRow(item);
    setEditReason("");
    const initial: Record<string, unknown> = {};
    const targetDs = loadedDataset ?? selectedDatasetMeta;
    if (linkedForm) {
      for (const field of linkedForm.fields) {
        const val = item.data[field.name];
        if (field.type === "checkbox" && typeof val === "string") {
          initial[field.name] = val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else {
          initial[field.name] = val ?? "";
        }
      }
    } else if (targetDs) {
      for (const v of targetDs.variables) {
        initial[v.name] = item.data[v.name] ?? "";
      }
    }
    setEditValues(initial);
  };

  const handleSaveRowEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetDs = loadedDataset ?? selectedDatasetMeta;
    if (!editingRow || !targetDs || !user) return;
    if (editReason.trim().length < 5) {
      toast.error("Indica un motivo de modificación (mínimo 5 caracteres) para el historial.");
      return;
    }
    setSavingRow(true);
    try {
      let cleaned: Record<string, Cell>;
      if (linkedForm) {
        cleaned = cleanRecordInput(linkedForm.fields, editValues);
      } else {
        cleaned = {};
        for (const v of targetDs.variables) {
          const raw = editValues[v.name];
          if (raw === null || raw === undefined || String(raw).trim() === "") {
            cleaned[v.name] = null;
          } else if (v.type === "numeric") {
            const num = Number(String(raw).replace(",", "."));
            if (!Number.isFinite(num)) {
              throw new Error(`La variable «${v.name}» requiere un valor numérico válido.`);
            }
            cleaned[v.name] = Math.round(num * 10000) / 10000;
          } else if (v.type === "binary") {
            const s = String(raw).trim();
            if (s === "0" || s === "1") cleaned[v.name] = Number(s);
            else cleaned[v.name] = s;
          } else if (v.type === "ordinal") {
            const s = String(raw).trim();
            const num = Number(s.replace(",", "."));
            cleaned[v.name] = Number.isFinite(num) && /^-?\d+([.,]\d+)?$/.test(s) ? num : s;
          } else {
            cleaned[v.name] = String(raw).trim();
          }
        }
      }

      await updateDatasetRow(projectId, targetDs, editingRow, cleaned, user, editReason.trim());
      toast.success("Registro actualizado con trazabilidad de versión y auditoría.");
      setEditingRow(null);
      setEditReason("");
      await loadDatasetData();
      onDatasetsChanged();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo guardar la edición del registro."));
    } finally {
      setSavingRow(false);
    }
  };

  const activeDs = loadedDataset ?? selectedDatasetMeta;
  const hasCrfMetadata = allRowItems.some((it) => it.source === "crf");

  return (
    <div className="space-y-5">
      <div className="apple-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="flex flex-wrap items-center gap-3">
          {datasets.length > 0 && (
            <select
              aria-label="Seleccionar base de datos"
              value={activeDatasetId}
              onChange={(e) => onSelectDataset(e.target.value)}
              className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3.5 py-2 text-sm font-medium text-[#1D1D1F] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
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
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86868B]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar registros…"
              className="w-56 rounded-xl border border-transparent bg-[#F5F5F7] py-2 pl-9 pr-3 text-sm text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:placeholder:text-[#6E6E73] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
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
              if (f) void handleFileUpload(f);
            }}
            data-testid="upload-file-input"
          />

          {canEdit && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
              data-testid="upload-dataset-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Importando…" : "Importar CSV / Excel"}
            </button>
          )}

          {activeDs?.form_id && (
            <Link
              to={`/proyectos/${projectId}/formularios/${activeDs.form_id}/capturar`}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              data-testid="capture-linked-form-btn"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Capturar paciente (CRF)
            </Link>
          )}

          {canEdit && activeDs && !activeDs.form_id && (
            <button
              type="button"
              disabled={creatingForm}
              onClick={() => void handleCreateFormFromDataset()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full border border-[#0071E3]/30 bg-[#0071E3]/[0.08] px-4 py-2 text-xs font-medium text-[#0071E3] transition-colors hover:bg-[#0071E3]/[0.14] disabled:opacity-60 dark:border-[#0A84FF]/40 dark:bg-[#0A84FF]/[0.12] dark:text-[#0A84FF]"
              data-testid="generate-form-from-dataset-btn"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              {creatingForm ? "Generando CRF…" : "Crear formulario CRF"}
            </button>
          )}

          {activeDs && onOpenSampleDashboard && (
            <button
              type="button"
              onClick={onOpenSampleDashboard}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full border border-[#0071E3]/30 bg-[#0071E3]/[0.08] px-4 py-2 text-xs font-medium text-[#0071E3] transition-colors hover:bg-[#0071E3]/[0.14] dark:border-[#0A84FF]/40 dark:bg-[#0A84FF]/[0.12] dark:text-[#0A84FF]"
              data-testid="open-sample-dashboard-btn"
            >
              <PieChart className="h-3.5 w-3.5" />
              Descripción de la muestra
            </button>
          )}

          {activeDs && canExport && (
            <button
              type="button"
              onClick={() => {
                setExportReason("");
                setIncludeIdentifiers(false);
                setExportModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
              data-testid="export-csv-btn"
            >
              <Download className="h-3.5 w-3.5 text-[#6E6E73] dark:text-[#98989D]" />
              Exportar CSV controlado
            </button>
          )}

          {canEdit && activeDs && !activeDs.form_id && (
            <button
              type="button"
              onClick={() => void handleDeleteDataset()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full border border-rose-200/80 bg-white px-3.5 py-2 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:bg-[#1C1C1E] dark:text-rose-400 dark:hover:bg-rose-950/30"
              data-testid="delete-dataset-btn"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </button>
          )}
        </div>
      </div>

      {/* Ready-to-view Sample Dashboard Notification */}
      {recentUploadInfo && onOpenSampleDashboard && (
        <div
          data-testid="sample-dashboard-ready-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#0071E3]/25 bg-[#0071E3]/[0.06] px-4 py-3 text-xs text-[#1D1D1F] dark:border-[#0A84FF]/35 dark:bg-[#0A84FF]/10 dark:text-[#F5F5F7]"
        >
          <div className="flex items-center gap-2.5">
            <PieChart className="h-4 w-4 shrink-0 text-[#0071E3] dark:text-[#0A84FF]" />
            <span>
              Panel <strong>Descripción de la muestra</strong> generado automáticamente para{" "}
              <strong>{recentUploadInfo.name}</strong> ({recentUploadInfo.rows} registros) y sincronizado en tiempo real.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSampleDashboard}
              className="inline-flex items-center gap-1 rounded-full bg-[#0071E3] px-3.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#0077ED] dark:bg-[#0A84FF]"
            >
              Ver gráficos de la muestra
            </button>
            <button
              type="button"
              onClick={() => setRecentUploadInfo(null)}
              className="text-[11px] font-medium text-[#6E6E73] hover:underline dark:text-[#98989D]"
            >
              Ocultar
            </button>
          </div>
        </div>
      )}

      {/* Upload Privacy / PII Warning Banner */}
      {uploadWarnings && (
        <div
          data-testid="upload-pii-warning-banner"
          className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <div className="font-semibold">
                Alerta RGPD al importar: posibles identificadores directos detectados en el archivo
              </div>
              {uploadWarnings.identifierColumns.length > 0 && (
                <div>
                  Columnas posiblemente identificativas:{" "}
                  <span className="font-mono font-medium">{uploadWarnings.identifierColumns.join(", ")}</span> (se excluirán automáticamente de exportaciones pseudonimizadas).
                </div>
              )}
              {uploadWarnings.piiWarnings.length > 0 && (
                <div>
                  Categorías detectadas en celdas: <strong>{uploadWarnings.piiWarnings.join(", ")}</strong>. Traslada las identidades civiles a <strong>Pseudonimización y consentimientos</strong>.
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setUploadWarnings(null)}
            className="text-[11px] font-medium underline hover:no-underline"
          >
            Cerrar aviso
          </button>
        </div>
      )}

      {/* Controlled Export Checksum Confirmation Banner */}
      {lastExportReport && (
        <div
          data-testid="export-checksum-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              Exportación auditada ({lastExportReport.rowCount} filas) · SHA-256:{" "}
              <code className="font-mono font-semibold">{lastExportReport.sha256}</code>
              {lastExportReport.strippedColumns.length > 0 && (
                <>
                  {" · "}Columnas identificativas suprimidas:{" "}
                  <span className="font-mono">{lastExportReport.strippedColumns.join(", ")}</span>
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLastExportReport(null)}
            className="text-[11px] font-medium underline"
          >
            Ocultar
          </button>
        </div>
      )}

      {!activeDs ? (
        <div className="apple-card rounded-3xl border border-dashed border-black/[0.12] bg-white p-14 text-center dark:border-white/[0.12] dark:bg-[#141416]">
          <p className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
            Este estudio todavía no tiene bases de datos cargadas.
          </p>
          <p className="mt-1.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
            Importa un archivo CSV o Excel (.xlsx) para crear la base y su formulario CRF, o diseña un formulario desde cero.
          </p>
        </div>
      ) : (
        <div className="apple-card overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-[#141416]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.05] px-5 py-3 text-xs text-[#6E6E73] dark:border-white/[0.06] dark:text-[#98989D]">
            <span>
              Mostrando{" "}
              <strong className="font-mono tabular-nums font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                {filteredItems.length
                  ? `${Math.min(filteredItems.length, offset + 1)}–${Math.min(filteredItems.length, offset + pagedItems.length)}`
                  : "0"}
              </strong>{" "}
              de <strong className="font-mono tabular-nums font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">{filteredItems.length}</strong> registros ·{" "}
              <strong className="font-mono tabular-nums font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">{activeDs.variables.length}</strong> variables
              {linkedForm && (
                <>
                  {" · "}
                  <Link
                    to={`/proyectos/${projectId}/formularios/${linkedForm.id}/editar`}
                    className="font-medium text-[#0071E3] hover:underline dark:text-[#0A84FF]"
                  >
                    Formulario CRF: {linkedForm.name}
                  </Link>
                </>
              )}
            </span>
            <span>
              {canEdit
                ? "Ajusta el tipo estadístico en la cabecera o edita registros CRF no bloqueados con motivo"
                : "Vista de solo lectura"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-black/[0.06] bg-[#F5F5F7]/70 dark:border-white/[0.08] dark:bg-[#1C1C1E]/80">
                  <th className="px-3.5 py-3 text-left font-mono text-[11px] font-medium text-[#86868B]">#</th>
                  {hasCrfMetadata && (
                    <>
                      <th className="px-3.5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6E6E73] dark:text-[#98989D]">
                        Sujeto
                      </th>
                      <th className="px-3.5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6E6E73] dark:text-[#98989D]">
                        Estado CRF
                      </th>
                    </>
                  )}
                  {canEdit && (
                    <th className="px-3.5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6E6E73] dark:text-[#98989D]">
                      Acción
                    </th>
                  )}
                  {activeDs.variables.map((v) => (
                    <th key={v.name} className="min-w-[136px] px-3.5 py-3 text-left align-top">
                      <div className="font-mono text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">{v.name}</div>
                      {v.label && (
                        <div className="truncate text-[11px] font-normal text-[#6E6E73] dark:text-[#98989D]">{v.label}</div>
                      )}
                      <div className="mt-1.5">
                        {canEdit ? (
                          <select
                            aria-label={`Tipo de variable ${v.name}`}
                            value={v.type}
                            onChange={(e) => void handleChangeVarType(v.name, e.target.value as VarType)}
                            className="rounded-lg border border-black/[0.08] bg-white px-2 py-0.5 text-[11px] font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#141416] dark:text-[#D1D1D6]"
                            data-testid={`vartype-${v.name}`}
                          >
                            {VAR_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {VAR_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[11px] font-normal text-[#6E6E73] dark:text-[#98989D]">{VAR_LABEL[v.type]}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {loading && !allRowItems.length ? (
                  <tr>
                    <td
                      colSpan={activeDs.variables.length + (canEdit ? 2 : 1) + (hasCrfMetadata ? 2 : 0)}
                      className="px-4 py-12 text-center text-[#6E6E73] dark:text-[#98989D]"
                    >
                      Cargando matriz de datos…
                    </td>
                  </tr>
                ) : !pagedItems.length ? (
                  <tr>
                    <td
                      colSpan={activeDs.variables.length + (canEdit ? 2 : 1) + (hasCrfMetadata ? 2 : 0)}
                      className="px-4 py-12 text-center text-[#6E6E73] dark:text-[#98989D]"
                    >
                      No hay registros que coincidan con el filtro.
                    </td>
                  </tr>
                ) : (
                  pagedItems.map((item, idx) => {
                    const isLockedCrf =
                      item.source === "crf" && (item.status === "verificado" || item.status === "bloqueado");
                    return (
                      <tr key={item.row_id} className="transition-colors hover:bg-[#F5F5F7]/60 dark:hover:bg-white/[0.025]">
                        <td className="px-3.5 py-2.5 font-mono tabular-nums text-[#86868B]">{offset + idx + 1}</td>
                        {hasCrfMetadata && (
                          <>
                            <td className="px-3.5 py-2.5 whitespace-nowrap font-mono text-[11px] text-[#424245] dark:text-[#D1D1D6]">
                              {item.subject_pseudo_id || "—"}
                            </td>
                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                              {item.status ? (
                                <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[item.status]}`}>
                                  {CRF_STATUS_LABEL[item.status]}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </>
                        )}
                        {canEdit && (
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            {isLockedCrf ? (
                              <span
                                title="Registro verificado/bloqueado. Requiere reapertura controlada desde el CRF."
                                className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50/70 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                              >
                                <Lock className="h-3 w-3" />
                                Bloqueado
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openEditModal(item)}
                                data-testid={`edit-row-btn-${offset + idx}`}
                                className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] font-medium text-[#1D1D1F] transition-colors hover:border-[#0071E3] hover:text-[#0071E3] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#E5E5EA] dark:hover:border-[#0A84FF] dark:hover:text-[#0A84FF]"
                              >
                                <Pencil className="h-3 w-3" />
                                Editar
                              </button>
                            )}
                          </td>
                        )}
                        {activeDs.variables.map((v) => {
                          const val = item.data[v.name];
                          const isMissing = val === null || val === undefined || val === "";
                          const isNum = v.type === "numeric" && typeof val === "number";
                          return (
                            <td
                              key={v.name}
                              className={`px-3.5 py-2.5 whitespace-nowrap ${
                                isNum ? "font-mono tabular-nums text-[#1D1D1F] dark:text-[#F5F5F7]" : "text-[#424245] dark:text-[#D1D1D6]"
                              }`}
                            >
                              {isMissing ? (
                                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                  — Perdido
                                </span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filteredItems.length > limit && (
            <div className="flex items-center justify-between border-t border-black/[0.05] px-5 py-3 dark:border-white/[0.06]">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="rounded-full border border-black/[0.08] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] disabled:opacity-40 dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
              >
                Anterior
              </button>
              <span className="font-mono text-xs tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                Página {Math.floor(offset / limit) + 1} de {Math.ceil(filteredItems.length / limit)}
              </span>
              <button
                type="button"
                disabled={offset + limit >= filteredItems.length}
                onClick={() => setOffset(offset + limit)}
                className="rounded-full border border-black/[0.08] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] disabled:opacity-40 dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}

      {/* Controlled Export Modal */}
      {exportModalOpen && activeDs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141416]">
            <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4 dark:border-white/[0.08]">
              <div>
                <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Exportación controlada · {activeDs.name}
                </h3>
                <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                  Validada en servidor, auditada y con suma SHA-256 ({allRowItems.length} filas).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#86868B] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                aria-label="Cerrar modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleControlledExport} className="p-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Motivo de la exportación (mínimo 10 caracteres, queda registrado en Audit Trail) *
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={10}
                  value={exportReason}
                  onChange={(e) => setExportReason(e.target.value)}
                  placeholder="Ej: Análisis intermedio para comité de ética del estudio cohorte 2026"
                  data-testid="export-reason-input"
                  className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2.5 text-xs text-[#1D1D1F] placeholder:text-[#86868B] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                />
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 p-3 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
                <input
                  type="checkbox"
                  disabled={!canIncludeRawIdentifiers}
                  checked={canIncludeRawIdentifiers ? includeIdentifiers : false}
                  onChange={(e) => setIncludeIdentifiers(e.target.checked)}
                  data-testid="export-include-ids-checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-black/20 text-[#0071E3]"
                />
                <div>
                  <div className="font-medium text-[#1D1D1F] dark:text-white">
                    Incluir columnas posiblemente identificativas (por defecto se eliminan)
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                    {canIncludeRawIdentifiers
                      ? "Desactivado por defecto para minimizar riesgo RGPD. Actívalo solo si está estrictamente justificado."
                      : "Solo el Investigador Principal (Admin) o Coordinador pueden incluir columnas identificativas."}
                  </p>
                </div>
              </label>

              {allRowItems.length > 500 && !canIncludeRawIdentifiers && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  Esta cohorte supera las 500 filas. Las exportaciones masivas (&gt;500 filas) están restringidas al Investigador Principal o Coordinador.
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                  className="rounded-full border border-black/[0.08] px-4 py-2 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.12] dark:text-[#F5F5F7]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={exporting || exportReason.trim().length < 10}
                  data-testid="confirm-export-csv-btn"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white hover:bg-[#0077ED] disabled:opacity-60"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting ? "Generando CSV…" : "Descargar CSV auditado"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Row Edit Modal */}
      {editingRow && activeDs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-md">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141416]">
            <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4 dark:border-white/[0.08]">
              <div>
                <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Editar registro #{editingRow.seq + 1} · {activeDs.name}
                </h3>
                <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                  {linkedForm
                    ? "Validación clínica de rangos CRF activada."
                    : "Modifica los valores de las variables y guarda los cambios con motivo obligatorio."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#86868B] transition hover:bg-black/[0.05] hover:text-[#1D1D1F] dark:hover:bg-white/[0.08] dark:hover:text-white"
                aria-label="Cerrar modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRowEdit} className="flex-1 overflow-y-auto p-6 space-y-4">
              {linkedForm
                ? linkedForm.fields.map((field) => (
                    <FieldInput
                      key={field.name}
                      field={field}
                      value={editValues[field.name]}
                      onChange={(val) => setEditValues((prev) => ({ ...prev, [field.name]: val }))}
                      disabled={savingRow}
                    />
                  ))
                : activeDs.variables.map((v) => {
                    const val = editValues[v.name];
                    const modalInputClass =
                      "w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2.5 text-sm text-[#1D1D1F] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15";
                    return (
                      <div key={v.name} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <label className="font-mono text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                            {v.name}
                          </label>
                          <span className="text-[11px] text-[#86868B]">{VAR_LABEL[v.type]}</span>
                        </div>
                        {v.type === "numeric" ? (
                          <input
                            type="number"
                            step="any"
                            value={val === null || val === undefined ? "" : String(val)}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                            className={`${modalInputClass} font-mono tabular-nums`}
                          />
                        ) : v.type === "date" ? (
                          <input
                            type="date"
                            value={val === null || val === undefined ? "" : String(val)}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                            className={`${modalInputClass} font-mono`}
                          />
                        ) : (v.type === "categorical" || v.type === "binary" || v.type === "ordinal") &&
                          v.levels.length > 0 &&
                          v.levels.length <= 15 ? (
                          <select
                            value={val === null || val === undefined ? "" : String(val)}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                            className={modalInputClass}
                          >
                            <option value="">(Perdido / vacío)</option>
                            {v.levels.map((lv) => (
                              <option key={lv} value={lv}>
                                {lv}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={val === null || val === undefined ? "" : String(val)}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                            className={modalInputClass}
                          />
                        )}
                      </div>
                    );
                  })}

              <div className="space-y-1.5 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
                <label className="block text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Motivo de modificación (obligatorio, mín. 5 caracteres) *
                </label>
                <input
                  type="text"
                  required
                  minLength={5}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Ej: Corrección tras revisión con fuente primaria clínica"
                  data-testid="edit-row-reason-input"
                  className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3.5 py-2 text-xs text-[#1D1D1F] placeholder:text-[#86868B] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingRow(null)}
                  className="rounded-full border border-black/[0.08] bg-white px-4 py-2 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingRow || editReason.trim().length < 5}
                  data-testid="save-row-edit-btn"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
                >
                  <Save className="h-3.5 w-3.5" />
                  {savingRow ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
