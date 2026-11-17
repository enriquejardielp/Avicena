export type Role = "admin" | "investigador" | "capturador";
export type VarType = "numeric" | "categorical" | "binary" | "date" | "text";
export type FieldType = "text" | "number" | "date" | "select" | "radio" | "checkbox" | "yesno" | "textarea";
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
  can_edit: boolean;
  can_manage_team: boolean;
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
  created_at: string;
}

export interface DatasetPage {
  dataset: Dataset;
  rows: Record<string, Cell>[];
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
  created_at: string;
  record_count: number;
}

export interface RecordOut {
  id: string;
  dataset_id: string;
  data: Record<string, Cell>;
  created_at: string;
  created_by: string;
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

export interface ChatMessage {
  id: string;
  dataset_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  analysis: AnalysisResult | null;
  created_at: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  investigador: "Investigador Principal",
  capturador: "Capturador de datos",
};

export const VAR_LABEL: Record<VarType, string> = {
  numeric: "Numérica",
  categorical: "Categórica",
  binary: "Binaria",
  date: "Fecha",
  text: "Texto",
};
