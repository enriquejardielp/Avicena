import { useEffect, useRef, useState } from "react";
import { Download, Printer, X } from "lucide-react";
import {
  buildTechnicalReportMarkdown,
  CONTROL_STATUS_MATRIX,
  REPORT_METADATA,
  TECHNICAL_SECTIONS,
} from "../../data/technicalSecurityReport.ts";
import { cn } from "../../lib/utils.ts";

interface TechnicalSecurityReportModalProps {
  open: boolean;
  onClose: () => void;
}

export default function TechnicalSecurityReportModal({
  open,
  onClose,
}: TechnicalSecurityReportModalProps) {
  const [activeSectionId, setActiveSectionId] = useState<string>(TECHNICAL_SECTIONS[0].id);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const jumpToSection = (id: string) => {
    setActiveSectionId(id);
    const container = scrollContainerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-report-section="${id}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleDownloadMarkdown = () => {
    const markdown = buildTechnicalReportMarkdown();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "avicena-informe-tecnico-seguridad.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="technical-report-title"
      data-testid="technical-security-report-modal"
      className="print-report-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-0 backdrop-blur-sm sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="print-report-sheet flex h-full w-full max-w-6xl flex-col overflow-hidden bg-white text-[#1D1D1F] shadow-[0_28px_80px_-20px_rgba(0,0,0,0.35)] sm:max-h-[90vh] sm:rounded-[24px] sm:border sm:border-black/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7] dark:sm:border-white/[0.1]">
        {/* Modal Top Bar */}
        <header className="no-print flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.07] px-5 py-4 sm:px-7 dark:border-white/[0.08]">
          <div className="min-w-0">
            <h2
              id="technical-report-title"
              className="font-heading text-lg font-semibold tracking-tight text-[#1D1D1F] sm:text-xl dark:text-white"
            >
              Informe técnico de seguridad para expertos
            </h2>
            <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
              {REPORT_METADATA.system} · Revisión {REPORT_METADATA.date} · {REPORT_METADATA.audience}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              data-testid="download-technical-report-btn"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#F5F5F7] dark:border-white/[0.14] dark:bg-[#1C1C1E] dark:text-white dark:hover:bg-[#2C2C2E]"
            >
              <Download className="h-3.5 w-3.5" />
              Descargar .md
            </button>
            <button
              type="button"
              onClick={handlePrint}
              data-testid="print-technical-report-btn"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#F5F5F7] dark:border-white/[0.14] dark:bg-[#1C1C1E] dark:text-white dark:hover:bg-[#2C2C2E]"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir / PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar informe técnico"
              data-testid="close-technical-report-btn"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[#6E6E73] transition-colors hover:bg-[#F5F5F7] hover:text-[#1D1D1F] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#98989D] dark:hover:bg-[#2C2C2E] dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Body: Sidebar Navigation + Long-form Technical Document */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label="Índice del informe técnico"
            className="no-print shrink-0 border-b border-black/[0.07] bg-[#F5F5F7]/70 p-4 md:w-72 md:overflow-y-auto md:border-b-0 md:border-r dark:border-white/[0.08] dark:bg-[#0D0D0F]/70"
          >
            <p className="mb-2.5 px-2 text-xs font-semibold text-[#6E6E73] dark:text-[#98989D]">
              Contenido técnico
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
              {TECHNICAL_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => jumpToSection(sec.id)}
                  className={cn(
                    "shrink-0 rounded-xl px-3 py-2 text-left text-xs transition-colors",
                    activeSectionId === sec.id
                      ? "bg-white font-semibold text-[#0071E3] shadow-xs dark:bg-[#1C1C1E] dark:text-[#0A84FF]"
                      : "text-[#424245] hover:bg-black/[0.04] hover:text-[#1D1D1F] dark:text-[#A1A1A6] dark:hover:bg-white/[0.06] dark:hover:text-white"
                  )}
                >
                  <span className="font-mono tabular-nums text-[11px] text-[#8E8E93]">{sec.number}.</span>{" "}
                  {sec.title}
                </button>
              ))}
              <button
                type="button"
                onClick={() => jumpToSection("matriz")}
                className={cn(
                  "shrink-0 rounded-xl px-3 py-2 text-left text-xs transition-colors",
                  activeSectionId === "matriz"
                    ? "bg-white font-semibold text-[#0071E3] shadow-xs dark:bg-[#1C1C1E] dark:text-[#0A84FF]"
                    : "text-[#424245] hover:bg-black/[0.04] hover:text-[#1D1D1F] dark:text-[#A1A1A6] dark:hover:bg-white/[0.06] dark:hover:text-white"
                )}
              >
                <span className="font-mono tabular-nums text-[11px] text-[#8E8E93]">07.</span>{" "}
                Matriz de controles verificados
              </button>
            </div>
          </nav>

          <div
            ref={scrollContainerRef}
            className="print-report-scroll flex-1 overflow-y-auto px-5 py-7 sm:px-9 sm:py-8"
          >
            {/* Print-only title */}
            <div className="mb-8 border-b border-black/[0.08] pb-6 dark:border-white/[0.09]">
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-[#1D1D1F] sm:text-[28px] dark:text-white">
                {REPORT_METADATA.title}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[#6E6E73] dark:text-[#A1A1A6]">
                {REPORT_METADATA.subtitle}
              </p>
              <p className="mt-3 font-mono text-xs tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                Versión evaluada: {REPORT_METADATA.date} · Alcance: Código fuente, reglas Firestore, suite de 13 pruebas y scripts GCP
              </p>
            </div>

            <div className="space-y-12">
              {TECHNICAL_SECTIONS.map((section) => (
                <section
                  key={section.id}
                  data-report-section={section.id}
                  className="scroll-mt-6 space-y-6 border-b border-black/[0.06] pb-10 dark:border-white/[0.08]"
                >
                  <div>
                    <p className="font-mono text-xs font-medium tabular-nums text-[#0071E3] dark:text-[#0A84FF]">
                      Sección {section.number}
                    </p>
                    <h3 className="mt-1 font-heading text-xl font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                      {section.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#6E6E73] dark:text-[#A1A1A6]">
                      {section.summary}
                    </p>
                  </div>

                  <div className="space-y-6">
                    {section.blocks.map((block) => (
                      <div key={block.heading} className="space-y-3">
                        <h4 className="font-heading text-[15px] font-semibold text-[#1D1D1F] dark:text-white">
                          {block.heading}
                        </h4>

                        {block.paragraphs.map((p, idx) => (
                          <p
                            key={idx}
                            className="text-sm leading-relaxed text-[#424245] dark:text-[#D1D1D6]"
                          >
                            {p}
                          </p>
                        ))}

                        {block.specs && block.specs.length > 0 && (
                          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-b border-black/[0.06] py-3.5 sm:grid-cols-2 dark:border-white/[0.08]">
                            {block.specs.map((spec) => (
                              <div key={spec.label}>
                                <dt className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
                                  {spec.label}
                                </dt>
                                <dd className="mt-0.5 font-mono text-xs text-[#1D1D1F] dark:text-[#F5F5F7]">
                                  {spec.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}

                        {block.bullets && block.bullets.length > 0 && (
                          <ul className="space-y-2 pl-4 text-sm leading-relaxed text-[#424245] list-disc marker:text-[#8E8E93] dark:text-[#D1D1D6]">
                            {block.bullets.map((bullet, idx) => (
                              <li key={idx}>{bullet}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              {/* Section 07: Control Status Matrix */}
              <section data-report-section="matriz" className="scroll-mt-6 space-y-4 pb-4">
                <div>
                  <p className="font-mono text-xs font-medium tabular-nums text-[#0071E3] dark:text-[#0A84FF]">
                    Sección 07
                  </p>
                  <h3 className="mt-1 font-heading text-xl font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                    Matriz consolidada de controles verificados vs. requisitos externos
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#6E6E73] dark:text-[#A1A1A6]">
                    Evaluación estricta que diferencia lo implementado y probado en el repositorio frente a los pasos de aprovisionamiento Cloud y aprobación ética requeridos antes de operar con datos reales de pacientes.
                  </p>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-black/[0.08] dark:border-white/[0.1]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-black/[0.08] bg-[#F5F5F7] text-[#424245] dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#D1D1D6]">
                        <th className="px-4 py-3 font-semibold">Dominio</th>
                        <th className="px-4 py-3 font-semibold">Control</th>
                        <th className="px-4 py-3 font-semibold">Estado</th>
                        <th className="px-4 py-3 font-semibold">Evidencia técnica</th>
                        <th className="px-4 py-3 font-semibold">Requisito externo / aclaración</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.07]">
                      {CONTROL_STATUS_MATRIX.map((row) => (
                        <tr key={row.domain} className="align-top">
                          <td className="px-4 py-3 font-medium text-[#1D1D1F] dark:text-white whitespace-nowrap">
                            {row.domain}
                          </td>
                          <td className="px-4 py-3 text-[#424245] dark:text-[#D1D1D6]">
                            {row.control}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 font-mono font-semibold whitespace-nowrap",
                              row.status === "VERIFICADO"
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-amber-700 dark:text-amber-400"
                            )}
                          >
                            {row.status}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] leading-relaxed text-[#424245] dark:text-[#A1A1A6]">
                            {row.implementation}
                          </td>
                          <td className="px-4 py-3 text-[#424245] dark:text-[#D1D1D6]">
                            {row.gapOrRequirement}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
