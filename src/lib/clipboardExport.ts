import type { AnalysisResult, Cell, ResultTable } from "./types.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCell(v: Cell): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function tableToHtml(tbl: ResultTable): string {
  const ths = tbl.columns
    .map((col, idx) => {
      const align = idx === 0 ? "left" : "right";
      return `<th style="border:1px solid #cbd5e1;background-color:#f1f5f9;padding:6px 10px;text-align:${align};font-size:10pt;font-weight:700;color:#0f172a;">${escapeHtml(
        col
      )}</th>`;
    })
    .join("");

  const trs = tbl.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, idx) => {
            const align = idx === 0 ? "left" : "right";
            const weight = idx === 0 ? "600" : "400";
            return `<td style="border:1px solid #cbd5e1;padding:5px 10px;text-align:${align};font-size:10pt;font-weight:${weight};color:#1e293b;">${escapeHtml(
              formatCell(cell)
            )}</td>`;
          })
          .join("")}</tr>`
    )
    .join("");

  const noteHtml = tbl.note
    ? `<p style="margin:4px 0 12px 0;font-size:9pt;color:#475569;font-style:italic;">${escapeHtml(tbl.note)}</p>`
    : "";

  return `
    <p style="margin:12px 0 6px 0;font-size:11pt;font-weight:700;color:#0f172a;">${escapeHtml(tbl.title)}</p>
    <table style="border-collapse:collapse;width:100%;font-family:Calibri,Arial,sans-serif;margin-bottom:6px;">
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
    ${noteHtml}
  `;
}

function tableToPlain(tbl: ResultTable): string {
  const header = tbl.columns.join("\t");
  const body = tbl.rows.map((r) => r.map((c) => formatCell(c)).join("\t")).join("\n");
  const lines = [tbl.title, header, body];
  if (tbl.note) lines.push(tbl.note);
  return lines.join("\n");
}

async function copyRichAndPlain(html: string, plain: string): Promise<void> {
  const wrappedHtml = `<html><body><div style="font-family:Calibri,Arial,sans-serif;color:#0f172a;">${html}</div></body></html>`;

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([wrappedHtml], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // Fallback below
    }
  }

  // Rich HTML fallback via offscreen selection (works cleanly for Word paste in many restricted contexts)
  try {
    const container = document.createElement("div");
    container.innerHTML = wrappedHtml;
    container.setAttribute("contenteditable", "true");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.opacity = "0";
    document.body.appendChild(container);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(container);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const copied = document.execCommand("copy");
    selection?.removeAllRanges();
    container.remove();
    if (copied) return;
  } catch {
    // Final text fallback below
  }

  await navigator.clipboard.writeText(plain);
}

export async function copyAnalysisToClipboard(result: AnalysisResult): Promise<void> {
  const tablesHtml = (result.tables ?? []).map(tableToHtml).join("");
  const html = `
    <h3 style="margin:0 0 4px 0;font-size:13pt;font-weight:700;color:#0f172a;">${escapeHtml(result.title)}</h3>
    <p style="margin:0 0 12px 0;font-size:10.5pt;color:#0369a1;font-weight:600;">${escapeHtml(result.summary)}</p>
    ${tablesHtml}
  `;

  const tablesPlain = (result.tables ?? []).map(tableToPlain).join("\n\n");
  const plain = [result.title, result.summary, tablesPlain].filter(Boolean).join("\n\n");

  await copyRichAndPlain(html, plain);
}

export async function copySingleTableToClipboard(table: ResultTable): Promise<void> {
  await copyRichAndPlain(tableToHtml(table), tableToPlain(table));
}

function inlineMdToHtml(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;">$1</code>');
}

export async function copyMarkdownToClipboard(markdown: string): Promise<void> {
  const lines = markdown.split("\n");
  const htmlParts: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      htmlParts.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      closeList();
      htmlParts.push(`<h4 style="margin:10px 0 4px 0;font-size:11pt;font-weight:700;color:#0f172a;">${inlineMdToHtml(trimmed.slice(4))}</h4>`);
    } else if (trimmed.startsWith("## ")) {
      closeList();
      htmlParts.push(`<h3 style="margin:12px 0 4px 0;font-size:12.5pt;font-weight:700;color:#0f172a;">${inlineMdToHtml(trimmed.slice(3))}</h3>`);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        htmlParts.push('<ul style="margin:4px 0 8px 18px;padding:0;">');
        inList = true;
      }
      htmlParts.push(`<li style="margin:2px 0;font-size:10.5pt;color:#1e293b;">${inlineMdToHtml(trimmed.slice(2))}</li>`);
    } else {
      closeList();
      htmlParts.push(`<p style="margin:4px 0;font-size:10.5pt;line-height:1.45;color:#1e293b;">${inlineMdToHtml(trimmed)}</p>`);
    }
  }
  closeList();

  const plain = markdown.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  await copyRichAndPlain(htmlParts.join(""), plain);
}

async function renderChartContainerToPngBlob(container: HTMLElement, title: string, subtitle?: string): Promise<Blob> {
  const svg = container.querySelector("svg.recharts-surface") || container.querySelector("svg");
  if (!svg) {
    throw new Error("No se encontró el gráfico SVG para exportar.");
  }

  const rect = svg.getBoundingClientRect();
  const svgWidth = Math.max(320, Math.round(rect.width || Number(svg.getAttribute("width")) || 640));
  const svgHeight = Math.max(200, Math.round(rect.height || Number(svg.getAttribute("height")) || 320));

  const cloned = svg.cloneNode(true) as SVGSVGElement;
  cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  cloned.setAttribute("width", String(svgWidth));
  cloned.setAttribute("height", String(svgHeight));
  cloned.style.color = "#334155";
  cloned.style.fontFamily = "Calibri, Arial, sans-serif";

  // Ensure text & axes using currentColor or dark-mode colors render crisply on white paper
  cloned.querySelectorAll("text, tspan").forEach((el) => {
    const fill = el.getAttribute("fill");
    if (!fill || fill === "currentColor") {
      el.setAttribute("fill", "#334155");
    }
  });
  cloned.querySelectorAll("line, path").forEach((el) => {
    const stroke = el.getAttribute("stroke");
    if (stroke === "currentColor") {
      el.setAttribute("stroke", "#475569");
    }
  });

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(cloned);
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("No se pudo rasterizar el gráfico."));
      image.src = svgUrl;
    });

    const scale = 2;
    const padX = 24;
    const headerH = subtitle ? 48 : 36;
    const padBottom = 16;
    const totalW = svgWidth + padX * 2;
    const totalH = svgHeight + headerH + padBottom;

    const canvas = document.createElement("canvas");
    canvas.width = totalW * scale;
    canvas.height = totalH * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexto 2D no disponible.");

    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, totalW, totalH);

    // Chart header for clean Word insertion
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 14px Calibri, Arial, sans-serif";
    ctx.fillText(title, padX, 24);
    if (subtitle) {
      ctx.fillStyle = "#475569";
      ctx.font = "400 11px Calibri, Arial, sans-serif";
      ctx.fillText(subtitle, padX, 40);
    }

    ctx.drawImage(img, padX, headerH, svgWidth, svgHeight);

    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) throw new Error("No se pudo generar la imagen PNG.");
    return pngBlob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyChartImageToClipboard(
  container: HTMLElement,
  title: string,
  subtitle?: string
): Promise<"copied" | "downloaded"> {
  const pngBlob = await renderChartContainerToPngBlob(container, title, subtitle);

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      return "copied";
    } catch {
      // Some embedded browser contexts restrict image clipboard writes; download PNG cleanly as fallback
    }
  }

  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  triggerBlobDownload(pngBlob, `${slug || "grafico_avicena"}.png`);
  return "downloaded";
}

export async function downloadChartPng(
  container: HTMLElement,
  title: string,
  subtitle?: string
): Promise<void> {
  const pngBlob = await renderChartContainerToPngBlob(container, title, subtitle);
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  triggerBlobDownload(pngBlob, `${slug || "grafico_avicena"}.png`);
}
