import type { AnalysisResult, ChatMessage } from "./types.ts";

let tokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: (() => Promise<string | null>) | null): void {
  tokenProvider = provider;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function errMsg(err: unknown, fallback = "Ha ocurrido un error inesperado."): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) {
    if (err.message.startsWith("{") && err.message.includes('"operationType"')) {
      try {
        const parsed = JSON.parse(err.message) as { error?: string };
        if (parsed.error?.toLowerCase().includes("permission")) {
          return "No tienes permisos suficientes para esta operación en la base de datos.";
        }
        return parsed.error || fallback;
      } catch {
        return fallback;
      }
    }
    return err.message;
  }
  return fallback;
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = `Error HTTP ${res.status}`;
  let body: unknown = null;
  try {
    body = await res.json();
    if (body && typeof body === "object" && "detail" in body && typeof (body as { detail: unknown }).detail === "string") {
      detail = (body as { detail: string }).detail;
    }
  } catch {
    // keep default
  }
  return new ApiError(res.status, detail, body);
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = tokenProvider ? await tokenProvider().catch(() => null) : null;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface StreamHandlers {
  onStatus?: (text: string) => void;
  onAnalysis?: (result: AnalysisResult) => void;
  onDelta?: (text: string) => void;
  onError?: (text: string) => void;
  onDone?: (msg: ChatMessage) => void;
}

export async function apiStream(path: string, body: unknown, handlers: StreamHandlers): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw new ApiError(500, "No se recibió flujo de respuesta del servidor.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (!dataLines.length) return;
    const rawJson = dataLines.join("\n");
    try {
      const parsed = JSON.parse(rawJson);
      if (eventName === "status") handlers.onStatus?.(parsed.text ?? "");
      else if (eventName === "analysis") handlers.onAnalysis?.(parsed as AnalysisResult);
      else if (eventName === "delta") handlers.onDelta?.(parsed.text ?? "");
      else if (eventName === "error") handlers.onError?.(parsed.text ?? "Error en el asistente");
      else if (eventName === "done") handlers.onDone?.(parsed as ChatMessage);
    } catch {
      // ignore malformed chunk
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (block.trim()) processBlock(block);
      idx = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) processBlock(buffer);
}
