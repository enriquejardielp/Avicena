import { useMemo, useState } from "react";
import {
  Archive,
  Check,
  Copy,
  Pin,
  PinOff,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import { copyMarkdownToClipboard } from "../../lib/clipboardExport.ts";
import { deleteSavedAnalysis, updateSavedAnalysisMeta } from "../../lib/firestoreDb.ts";
import type { AnalysisResult, Dataset, SavedAnalysis } from "../../lib/types.ts";
import { cn, formatShortDate } from "../../lib/utils.ts";
import { ResultView } from "../analysis/ResultView.tsx";

interface SavedAnalysesTabProps {
  projectId: string;
  datasets: Dataset[];
  analyses: SavedAnalysis[];
  canEdit: boolean;
  onUpdated: (updated: SavedAnalysis) => void;
  onDeleted: (analysisId: string) => void;
  onAskCopilot: (prompt: string) => void;
}

export function SavedAnalysesTab({
  projectId,
  datasets,
  analyses,
  canEdit,
  onUpdated,
  onDeleted,
  onAskCopilot,
}: SavedAnalysesTabProps) {
  const { user } = useAuth();
  const [filterMode, setFilterMode] = useState<"all" | "pinned">("all");
  const [datasetFilter, setDatasetFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [editingTitle, setEditingTitle] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [dirtyMeta, setDirtyMeta] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [copiedInterp, setCopiedInterp] = useState(false);

  const pinnedCount = useMemo(() => analyses.filter((a) => a.is_pinned).length, [analyses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return analyses
      .filter((a) => (filterMode === "pinned" ? a.is_pinned : true))
      .filter((a) => (datasetFilter ? a.dataset_id === datasetFilter : true))
      .filter((a) => {
        if (!q) return true;
        return (
          a.title.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.dataset_name.toLowerCase().includes(q) ||
          a.note.toLowerCase().includes(q) ||
          a.test.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [analyses, filterMode, datasetFilter, search]);

  const active = useMemo(() => {
    if (!filtered.length) return null;
    return filtered.find((a) => a.id === selectedId) ?? filtered[0];
  }, [filtered, selectedId]);

  const selectItem = (item: SavedAnalysis) => {
    setSelectedId(item.id);
    setEditingTitle(item.title);
    setEditingNote(item.note);
    setDirtyMeta(false);
  };

  // Keep draft aligned when active item switches automatically
  const currentTitle = dirtyMeta && active?.id === selectedId ? editingTitle : (active?.title ?? "");
  const currentNote = dirtyMeta && active?.id === selectedId ? editingNote : (active?.note ?? "");

  const handleTogglePin = async (item: SavedAnalysis) => {
    if (!user) return;
    const nextPinned = !item.is_pinned;
    try {
      await updateSavedAnalysisMeta(projectId, item.id, { is_pinned: nextPinned }, user);
      onUpdated({ ...item, is_pinned: nextPinned, updated_at: new Date().toISOString() });
      toast.success(nextPinned ? "Análisis fijado en favoritos." : "Análisis retirado de favoritos.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo actualizar el favorito."));
    }
  };

  const handleSaveMeta = async () => {
    if (!user || !active) return;
    setSavingMeta(true);
    try {
      const cleanTitle = currentTitle.trim() || active.title;
      await updateSavedAnalysisMeta(
        projectId,
        active.id,
        { title: cleanTitle, note: currentNote },
        user
      );
      onUpdated({
        ...active,
        title: cleanTitle,
        note: currentNote,
        updated_at: new Date().toISOString(),
      });
      setDirtyMeta(false);
      toast.success("Título y nota clínica actualizados.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo guardar la nota clínica."));
    } finally {
      setSavingMeta(false);
    }
  };

  const handleDelete = async (item: SavedAnalysis) => {
    if (!user) return;
    try {
      await deleteSavedAnalysis(projectId, item.id, user);
      onDeleted(item.id);
      if (selectedId === item.id) setSelectedId("");
      toast.success("Análisis eliminado del historial del estudio.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo eliminar el análisis guardado."));
    }
  };

  if (!analyses.length) {
    return (
      <div className="apple-card flex flex-col items-center justify-center rounded-3xl border border-dashed border-black/[0.12] bg-white p-14 text-center dark:border-white/[0.12] dark:bg-[#141416]">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0071E3]/10 text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]">
          <Archive className="h-6 w-6" />
        </span>
        <h3 className="mt-4 font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
          Todavía no hay análisis guardados en este estudio
        </h3>
        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
          Cada prueba ejecutada en Bioestadística o mediante el Asistente IA se guarda automáticamente aquí junto con sus tablas APA, gráficos y notas clínicas para consultarlos o copiarlos a Word más adelante.
        </p>
      </div>
    );
  }

  const activeResult: AnalysisResult | null = active
    ? {
        test: active.test,
        title: active.title,
        summary: active.summary,
        tables: active.tables,
        charts: active.charts,
        ...(active.provenance ? { provenance: active.provenance } : {}),
        ...(active.reproducible_script ? { reproducible_script: active.reproducible_script } : {}),
      }
    : null;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="apple-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex rounded-xl bg-black/[0.045] p-1 dark:bg-white/[0.07]">
            <button
              type="button"
              onClick={() => setFilterMode("all")}
              data-testid="saved-filter-all"
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                filterMode === "all"
                  ? "bg-white text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white"
                  : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
              )}
            >
              Todos ({analyses.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("pinned")}
              data-testid="saved-filter-pinned"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                filterMode === "pinned"
                  ? "bg-white text-[#0071E3] shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-[#0A84FF]"
                  : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
              )}
            >
              <Pin className="h-3.5 w-3.5" />
              Favoritos fijados ({pinnedCount})
            </button>
          </div>

          {datasets.length > 1 && (
            <select
              aria-label="Filtrar por base de datos"
              value={datasetFilter}
              onChange={(e) => setDatasetFilter(e.target.value)}
              className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-2 text-xs font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
            >
              <option value="">Todas las bases ({datasets.length})</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86868B]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar análisis, nota o resumen…"
            className="w-64 rounded-xl border border-transparent bg-[#F5F5F7] py-1.5 pl-9 pr-8 text-xs text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:placeholder:text-[#6E6E73] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
            data-testid="saved-search-input"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Master-detail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <aside className="lg:col-span-4 space-y-2.5 max-h-[760px] overflow-y-auto pr-1">
          {!filtered.length ? (
            <div className="rounded-2xl border border-dashed border-black/[0.12] bg-white p-8 text-center text-xs text-[#6E6E73] dark:border-white/[0.12] dark:bg-[#141416] dark:text-[#98989D]">
              No hay análisis guardados que coincidan con el filtro actual.
            </div>
          ) : (
            filtered.map((item) => {
              const isSelected = active?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => selectItem(item)}
                  data-testid={`saved-item-${item.id}`}
                  className={cn(
                    "cursor-pointer rounded-2xl border p-4 transition-all",
                    isSelected
                      ? "border-[#0071E3] bg-[#0071E3]/[0.04] shadow-[0_2px_10px_rgba(0,113,227,0.08)] dark:border-[#0A84FF] dark:bg-[#0A84FF]/[0.08]"
                      : "apple-card border-black/[0.06] bg-white hover:border-black/[0.12] dark:border-white/[0.08] dark:bg-[#141416] dark:hover:border-white/[0.15]"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                        <span className="truncate">{item.dataset_name}</span>
                        <span>·</span>
                        <span>{item.source === "copilot" ? "Asistente IA" : "Bioestadística"}</span>
                      </div>
                      <h4 className="mt-1 font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7] line-clamp-2">
                        {item.title}
                      </h4>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleTogglePin(item);
                        }}
                        title={item.is_pinned ? "Quitar de favoritos" : "Fijar como favorito"}
                        className={cn(
                          "shrink-0 rounded-full p-1.5 transition-colors",
                          item.is_pinned
                            ? "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300"
                            : "text-[#86868B] hover:bg-black/[0.05] hover:text-[#1D1D1F] dark:hover:bg-white/[0.08] dark:hover:text-white"
                        )}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 font-mono text-[11px] text-[#424245] dark:text-[#D1D1D6]">
                    {item.summary}
                  </p>
                  {item.note && (
                    <p className="mt-1.5 line-clamp-1 text-[11px] italic text-[#0071E3] dark:text-[#0A84FF]">
                      Nota: {item.note}
                    </p>
                  )}
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#86868B] dark:text-[#98989D]">
                    <span>{item.created_by_name}</span>
                    <span>{formatShortDate(item.created_at)}</span>
                  </div>
                </div>
              );
            })
          )}
        </aside>

        <section className="lg:col-span-8 space-y-5">
          {active && activeResult && (
            <>
              <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-[240px] space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#6E6E73] dark:text-[#98989D]">
                      <span className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                        {active.dataset_name}
                      </span>
                      <span>·</span>
                      <span>{active.source === "copilot" ? "Generado desde Asistente IA" : "Panel Bioestadística"}</span>
                      <span>·</span>
                      <span>
                        {active.created_by_name} ({formatShortDate(active.created_at)})
                      </span>
                    </div>

                    {canEdit ? (
                      <input
                        type="text"
                        aria-label="Título del análisis guardado"
                        value={currentTitle}
                        onChange={(e) => {
                          setSelectedId(active.id);
                          setEditingTitle(e.target.value);
                          setEditingNote(currentNote);
                          setDirtyMeta(true);
                        }}
                        className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2 font-heading text-base font-semibold text-[#1D1D1F] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-white dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
                      />
                    ) : (
                      <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-white">
                        {active.title}
                      </h3>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleTogglePin(active)}
                        data-testid="toggle-pin-saved-btn"
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors",
                          active.is_pinned
                            ? "border-amber-300/80 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                            : "border-black/[0.08] bg-white text-[#1D1D1F] hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                        )}
                      >
                        {active.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        {active.is_pinned ? "Favorito fijado" : "Fijar favorito"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(active)}
                        data-testid="delete-saved-btn"
                        className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/80 bg-white px-3.5 py-2 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:bg-[#1C1C1E] dark:text-rose-400 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>

                {canEdit ? (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
                      Nota metodológica o comentario para el manuscrito
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <textarea
                        rows={2}
                        value={currentNote}
                        onChange={(e) => {
                          setSelectedId(active.id);
                          setEditingTitle(currentTitle);
                          setEditingNote(e.target.value);
                          setDirtyMeta(true);
                        }}
                        placeholder="Ej: Incluir en Tabla 2 del manuscrito tras ajustar por edad…"
                        className="flex-1 rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2 text-xs text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
                      />
                      <button
                        type="button"
                        disabled={!dirtyMeta || savingMeta}
                        onClick={handleSaveMeta}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0077ED] disabled:opacity-45 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingMeta ? "Guardando…" : "Guardar nota"}
                      </button>
                    </div>
                  </div>
                ) : (
                  active.note && (
                    <div className="rounded-xl bg-[#F5F5F7] px-4 py-2.5 text-xs text-[#424245] dark:bg-[#1C1C1E] dark:text-[#D1D1D6]">
                      <span className="font-semibold text-[#1D1D1F] dark:text-white">Nota clínica:</span> {active.note}
                    </div>
                  )
                )}
              </div>

              <ResultView
                result={activeResult}
                showHistoricNotice={!active.provenance}
                onAskCopilot={onAskCopilot}
              />

              {active.interpretation && (
                <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 space-y-3 dark:border-white/[0.08] dark:bg-[#141416]">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                      Interpretación clínica guardada
                    </h4>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await copyMarkdownToClipboard(active.interpretation ?? "");
                          setCopiedInterp(true);
                          setTimeout(() => setCopiedInterp(false), 2000);
                          toast.success("Interpretación copiada para pegar en Word.");
                        } catch {
                          toast.error("No se pudo copiar la interpretación.");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                    >
                      {copiedInterp ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-[#6E6E73] dark:text-[#98989D]" />}
                      {copiedInterp ? "Copiado" : "Copiar interpretación"}
                    </button>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#424245] dark:text-[#D1D1D6]">
                    {active.interpretation}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
