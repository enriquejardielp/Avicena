export type Role =
  | "admin"
  | "coordinador"
  | "investigador"
  | "monitor_clinico"
  | "estadistico"
  | "admin_tecnico"
  | "capturador";

export type VarType = "numeric" | "categorical" | "binary" | "date" | "text";
export type FieldType = "text" | "number" | "date" | "select" | "radio" | "checkbox" | "yesno" | "textarea";
export type CrfRecordStatus = "borrador" | "completado" | "enviado" | "verificado" | "bloqueado";
export type ConsentStatus = "vigente" | "retirado" | "pendiente" | "requiere_reconsentimiento";
export type ConsentMethod = "escrito" | "electronico" | "testigo_imparcial";
export type StudyStatus = "borrador" | "reclutamiento" | "seguimiento" | "cerrado" | "bloqueado" | "archivado";
export type QueryStatus = "abierta" | "respondida" | "correccion_solicitada" | "cerrada" | "cancelada";
export type DeviationSeverity = "menor" | "mayor" | "critica";
export type DeviationStatus = "abierta" | "en_investigacion" | "capa_en_curso" | "cerrada";

export type TestName =
  | "descriptives"
  | "frequencies"
  | "ttest"
  | "paired_ttest"
  | "mannwhitney"
  | "chi2"
  | "anova"
  | "correlation"
  | "linreg"
  | "logreg"
  | "kaplan_meier"
  | "table1"
  | "friedman"
  | "mcnemar"
  | "epidemiology_2x2"
  | "diagnostic_test"
  | "roc_auc"
  | "kappa_agreement"
  | "cox_ph"
  | "poisson_reg"
  | "sample_size";

export type Cell = string | number | boolean | null;

export interface Me {
  user_id: string;
  email: string;
  name: string;
  photo_url?: string | null;
}

export interface UserRow {
  user_id: string;
  email: string;
  name: string;
  photo_url?: string | null;
}

export interface ProjectMember {
  user_id: string | null;
  email: string;
  name: string;
  role: Role;
  invited_at: string;
  pending?: boolean;
  invite_id?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  members: ProjectMember[];
  my_role: Role;
  created_at: string;
  dataset_count: number;
  form_count: number;
  record_count: number;
  analysis_count: number;
  can_edit: boolean;
  can_manage_team: boolean;
  can_access_clinical?: boolean;
  can_analyze?: boolean;
  can_access_identity_vault?: boolean;
  can_export_data?: boolean;
  can_verify_crf?: boolean;
  can_view_audit?: boolean;
}

export interface StudyGovernance {
  project_id: string;
  ai_enabled: boolean;
  ai_allow_clinical_text: boolean;
  ai_allow_dataset_context: boolean;
  ai_dpa_confirmed: boolean;
  require_mfa: boolean;
  require_active_consent?: boolean;
  updated_by?: string;
  updated_at?: string;
}

export interface StudyAmendment {
  id: string;
  version: string;
  summary: string;
  effective_date: string;
  approved_by: string;
  approved_by_name: string;
  created_at: string;
}

export interface StudyLifecycle {
  project_id: string;
  study_status: StudyStatus;
  protocol_version: string;
  amendments: StudyAmendment[];
  last_status_reason?: string;
  updated_by?: string;
  updated_by_name?: string;
  updated_at?: string;
}

export interface QueryMessageEntry {
  id: string;
  author_uid: string;
  author_name: string;
  author_role: string;
  message: string;
  action_type: "open" | "response" | "correction_requested" | "close" | "cancel";
  created_at: string;
}

export interface ClinicalQuery {
  id: string;
  project_id: string;
  record_id: string;
  form_id: string;
  subject_pseudo_id?: string | null;
  variable_name: string;
  status: QueryStatus;
  opened_by: string;
  opened_by_name: string;
  opened_at: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
  messages: QueryMessageEntry[];
  updated_at: string;
}

export interface ProtocolDeviation {
  id: string;
  project_id: string;
  subject_pseudo_id?: string | null;
  record_id?: string | null;
  title: string;
  description: string;
  severity: DeviationSeverity;
  status: DeviationStatus;
  occurred_at: string;
  detected_at: string;
  impact_assessment: string;
  capa_plan: string;
  responsible_name: string;
  resolution_notes?: string;
  reported_by: string;
  reported_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface ElectronicSignatureManifest {
  id: string;
  project_id: string;
  target_type: "crf_record" | "study_lifecycle";
  target_id: string;
  target_version?: number;
  meaning: string;
  reason: string;
  signer_uid: string;
  signer_name: string;
  signer_role: string;
  auth_time_utc: string;
  signed_at_utc: string;
  attestation_hash: string;
  key_id: string;
  signature_level: "reauthenticated_hmac_attestation";
}

export interface Variable {
  name: string;
  label: string;
  type: VarType;
  levels: string[];
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  source: "upload" | "form";
  form_id: string | null;
  variables: Variable[];
  n_rows: number;
  chunk_count?: number;
  created_at: string;
}

export interface DatasetRowItem {
  row_id: string;
  seq: number;
  data: Record<string, Cell>;
  source: "crf" | "chunk";
  status?: CrfRecordStatus;
  subject_pseudo_id?: string | null;
  created_by?: string;
  created_at?: string;
}

export interface DatasetPage {
  dataset: Dataset;
  rows: Record<string, Cell>[];
  rowItems: DatasetRowItem[];
  total: number;
}

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  choices: string[];
  min: number | null;
  max: number | null;
  unit: string;
  help: string;
}

export interface FormIn {
  name: string;
  description: string;
  fields: FormField[];
}

export interface Form extends FormIn {
  id: string;
  project_id: string;
  dataset_id: string;
  form_version?: number;
  created_at: string;
  record_count: number;
}

export interface RecordOut {
  id: string;
  dataset_id: string;
  seq?: number;
  subject_pseudo_id?: string | null;
  status?: CrfRecordStatus;
  version?: number;
  form_version?: number;
  last_change_reason?: string;
  data: Record<string, Cell>;
  created_at: string;
  created_by: string;
  updated_at?: string;
  updated_by?: string;
}

export interface CrfVersionEntry {
  id: string;
  record_id: string;
  version: number;
  form_version?: number;
  previous_status: CrfRecordStatus | null;
  new_status: CrfRecordStatus;
  previous_data: Record<string, Cell>;
  new_data: Record<string, Cell>;
  changed_by: string;
  changed_by_name: string;
  changed_at: string;
  reason: string;
}

export interface SealedIdentityPayload {
  version: "aes-256-gcm-v1" | "aes-256-gcm-v2";
  keyId?: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface VaultSubjectSummary {
  subject_pseudo_id: string;
  project_id: string;
  blind_index: string;
  created_by: string;
  created_at: string;
  consent_status: ConsentStatus;
}

export interface ConsentRecord {
  id: string;
  project_id: string;
  subject_pseudo_id: string;
  protocol_version: string;
  document_title: string;
  method: ConsentMethod;
  status: ConsentStatus;
  signed_at: string;
  withdrawn_at?: string | null;
  withdrawal_reason?: string;
  recorded_by: string;
  recorded_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  project_id: string;
  actor_uid: string;
  actor_name: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: "SUCCESS" | "DENIED" | "ERROR";
  reason: string;
  details: Record<string, unknown>;
  timestamp_utc: string;
  prev_hash: string;
  entry_hash: string;
  key_id?: string;
}

export interface ResultTable {
  title: string;
  columns: string[];
  rows: Cell[][];
  note: string;
}

export interface ResultChart {
  type: "histogram" | "bar" | "box" | "scatter" | "survival" | "groupedbar" | "roc";
  title: string;
  data: Record<string, Cell>[];
  x: string;
  series: string[];
  meta: Record<string, Cell>;
}

export interface AnalysisResult {
  test: string;
  title: string;
  summary: string;
  tables: ResultTable[];
  charts: ResultChart[];
}

export interface SavedAnalysis {
  id: string;
  project_id: string;
  dataset_id: string;
  dataset_name: string;
  test: string;
  title: string;
  summary: string;
  params: Record<string, unknown>;
  tables: ResultTable[];
  charts: ResultChart[];
  interpretation: string | null;
  source: "manual" | "copilot";
  is_pinned: boolean;
  note: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  dataset_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  analysis: AnalysisResult | null;
  created_at: string;
}

export interface FormExtractResponse {
  appliedValues: Record<string, unknown>;
  detectedCount: number;
  preservedExistingKeys: string[];
  missingKeys: string[];
  notes: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Investigador Principal (Admin)",
  coordinador: "Coordinador de Estudio",
  investigador: "Investigador Colaborador",
  monitor_clinico: "Monitor Clínico (CRA)",
  estadistico: "Estadístico",
  admin_tecnico: "Administrador Técnico",
  capturador: "Capturador de Datos",
};

export const CRF_STATUS_LABEL: Record<CrfRecordStatus, string> = {
  borrador: "Borrador",
  completado: "Completado",
  enviado: "Enviado",
  verificado: "Verificado",
  bloqueado: "Bloqueado",
};

export const CONSENT_STATUS_LABEL: Record<ConsentStatus, string> = {
  vigente: "Vigente",
  retirado: "Retirado",
  pendiente: "Pendiente",
  requiere_reconsentimiento: "Requiere reconsentimiento",
};

export const VAR_LABEL: Record<VarType, string> = {
  numeric: "Numérica",
  categorical: "Categórica",
  binary: "Binaria",
  date: "Fecha",
  text: "Texto",
};

export const STUDY_STATUS_LABEL: Record<StudyStatus, string> = {
  borrador: "Borrador / Configuración",
  reclutamiento: "Activo (Reclutamiento)",
  seguimiento: "Seguimiento",
  cerrado: "Cerrado a captura",
  bloqueado: "Base bloqueada (Database Lock)",
  archivado: "Archivado",
};

export const QUERY_STATUS_LABEL: Record<QueryStatus, string> = {
  abierta: "Abierta",
  respondida: "Respondida por centro",
  correccion_solicitada: "Corrección solicitada",
  cerrada: "Cerrada",
  cancelada: "Cancelada",
};

export const DEVIATION_SEVERITY_LABEL: Record<DeviationSeverity, string> = {
  menor: "Menor",
  mayor: "Mayor",
  critica: "Crítica / Grave",
};

export const DEVIATION_STATUS_LABEL: Record<DeviationStatus, string> = {
  abierta: "Abierta",
  en_investigacion: "En investigación",
  capa_en_curso: "CAPA en curso",
  cerrada: "Cerrada",
};
