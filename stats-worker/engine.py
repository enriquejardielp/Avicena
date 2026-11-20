from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from lifelines import CoxPHFitter, KaplanMeierFitter
from lifelines.statistics import logrank_test, multivariate_logrank_test, proportional_hazard_test
from scipy import stats as sp_stats
from sklearn.calibration import calibration_curve
from sklearn.metrics import brier_score_loss, mean_absolute_error, mean_squared_error, roc_auc_score, roc_curve
from sklearn.model_selection import KFold, StratifiedKFold
import statsmodels.api as sm
from statsmodels.stats.anova import AnovaRM
from statsmodels.stats.contingency_tables import mcnemar as sm_mcnemar
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.inter_rater import cohens_kappa
from statsmodels.stats.multicomp import pairwise_tukeyhsd
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.outliers_influence import OLSInfluence, variance_inflation_factor
from statsmodels.stats.power import NormalIndPower, TTestIndPower
from statsmodels.stats.proportion import proportion_confint
from statsmodels.stats.stattools import durbin_watson
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.seasonal import seasonal_decompose
from statsmodels.tsa.stattools import acf, adfuller, pacf
from statsmodels.stats.diagnostic import acorr_ljungbox

from citations import build_library_citations


class WorkerStatsError(ValueError):
    pass


def rn(v: float | int | np.floating | np.integer, digits: int = 3) -> float:
    val = float(v)
    if not math.isfinite(val):
        return 0.0
    return round(val, digits)


def fp(p: float | np.floating | None) -> str:
    if p is None:
        return "—"
    val = float(p)
    if not math.isfinite(val):
        return "—"
    if val < 0.001:
        return "<0.001"
    return f"{val:.4f}"


def is_missing(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    if isinstance(v, str) and v.strip().lower() in ("", "na", "nan", "null", "none", "n/a", "missing", "."):
        return True
    return False


def to_num(v: Any) -> float | None:
    if is_missing(v) or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    try:
        s = str(v).strip().replace(",", ".")
        f = float(s)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def to_lbl(v: Any) -> str | None:
    if is_missing(v):
        return None
    if isinstance(v, bool):
        return "Sí" if v else "No"
    return str(v).strip()


def to_event01(v: Any) -> int | None:
    if is_missing(v):
        return None
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        if float(v) == 1.0:
            return 1
        if float(v) == 0.0:
            return 0
        return None
    s = str(v).strip().lower()
    if s in ("1", "si", "sí", "yes", "true", "evento", "event", "positivo", "pos", "fallecido", "muerto"):
        return 1
    if s in ("0", "no", "false", "censurado", "censored", "negativo", "neg", "vivo"):
        return 0
    return None


def resolve_binary_series(rows: list[dict[str, Any]], col: str) -> tuple[list[int | None], str, str]:
    raw_lbls = [to_lbl(r.get(col)) for r in rows]
    direct = [to_event01(r.get(col)) for r in rows]
    non_missing_idx = [i for i, lbl in enumerate(raw_lbls) if lbl is not None]
    if non_missing_idx and all(direct[i] is not None for i in non_missing_idx):
        return direct, "1", "0"
    uniq = sorted({raw_lbls[i] for i in non_missing_idx if raw_lbls[i] is not None})
    if len(uniq) != 2:
        raise WorkerStatsError(f"La variable binaria '{col}' debe tener exactamente 2 categorías (tiene {len(uniq)}).")
    neg_lbl, pos_lbl = uniq[0], uniq[1]
    mapped = [None if lbl is None else (1 if lbl == pos_lbl else 0) for lbl in raw_lbls]
    return mapped, pos_lbl, neg_lbl


def get_var_meta(variables: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(v.get("name", "")): v for v in variables if v.get("name")}


def ordinal_map(var_meta: dict[str, Any] | None, raw_vals: list[Any]) -> dict[str, float]:
    levels = [str(x).strip() for x in (var_meta or {}).get("levels", []) if str(x).strip()]
    if levels:
        return {lvl: float(i + 1) for i, lvl in enumerate(levels)}
    uniq = sorted({to_lbl(v) for v in raw_vals if to_lbl(v) is not None})
    return {lvl: float(i + 1) for i, lvl in enumerate(uniq)}


def extract_numeric_or_ordinal(rows: list[dict[str, Any]], col: str, var_map: dict[str, dict[str, Any]]) -> list[float]:
    meta = var_map.get(col)
    vtype = (meta or {}).get("type", "numeric")
    raw = [r.get(col) for r in rows]
    if vtype == "ordinal":
        nums = [to_num(v) for v in raw if not is_missing(v)]
        if nums and all(x is not None for x in nums):
            return [x for x in nums if x is not None]
        omap = ordinal_map(meta, raw)
        out: list[float] = []
        for v in raw:
            lbl = to_lbl(v)
            if lbl is not None and lbl in omap:
                out.append(omap[lbl])
        return out
    return [x for x in (to_num(v) for v in raw) if x is not None]


def extract_aligned_series(
    rows: list[dict[str, Any]],
    col: str,
    var_map: dict[str, dict[str, Any]],
) -> list[float | None]:
    meta = var_map.get(col)
    vtype = (meta or {}).get("type", "numeric")
    raw = [r.get(col) for r in rows]
    if vtype == "ordinal":
        omap = ordinal_map(meta, raw)
        out: list[float | None] = []
        for v in raw:
            num = to_num(v)
            if num is not None:
                out.append(num)
            else:
                lbl = to_lbl(v)
                out.append(omap.get(lbl) if lbl is not None else None)
        return out
    return [to_num(v) for v in raw]


def build_design_matrix(
    rows: list[dict[str, Any]],
    outcome: str,
    predictors: list[str],
    var_map: dict[str, dict[str, Any]],
    binary_outcome: bool = False,
) -> tuple[pd.DataFrame, pd.Series, list[str]]:
    if not predictors:
        raise WorkerStatsError("Selecciona al menos una variable predictora.")
    records: list[dict[str, Any]] = []
    for r in rows:
        item: dict[str, Any] = {}
        ok = True
        if binary_outcome:
            ev = to_event01(r.get(outcome))
            if ev is None:
                lbl = to_lbl(r.get(outcome))
                if lbl is None:
                    continue
                item[outcome] = lbl
            else:
                item[outcome] = ev
        else:
            yv = to_num(r.get(outcome))
            if yv is None:
                continue
            item[outcome] = yv
        for p in predictors:
            ptype = var_map.get(p, {}).get("type", "numeric")
            if ptype == "numeric":
                pv = to_num(r.get(p))
                if pv is None:
                    ok = False
                    break
                item[p] = pv
            elif ptype == "ordinal":
                pv = to_num(r.get(p))
                if pv is not None:
                    item[p] = pv
                else:
                    lbl = to_lbl(r.get(p))
                    if lbl is None:
                        ok = False
                        break
                    item[p] = lbl
            else:
                lbl = to_lbl(r.get(p))
                if lbl is None:
                    ok = False
                    break
                item[p] = lbl
        if ok:
            records.append(item)

    if len(records) < len(predictors) + 4:
        raise WorkerStatsError("Casos completos insuficientes para ajustar el modelo.")

    df = pd.DataFrame(records)
    if binary_outcome and df[outcome].dtype == object:
        levels = sorted(df[outcome].astype(str).unique().tolist())
        if len(levels) != 2:
            raise WorkerStatsError("La variable dependiente binaria debe tener exactamente 2 categorías.")
        df[outcome] = (df[outcome].astype(str) == levels[1]).astype(int)

    y = df[outcome].astype(float)
    X_parts: list[pd.DataFrame] = []
    for p in predictors:
        ptype = var_map.get(p, {}).get("type", "numeric")
        if ptype == "numeric" or (ptype == "ordinal" and pd.api.types.is_numeric_dtype(df[p])):
            X_parts.append(df[[p]].astype(float))
        else:
            cats = (var_map.get(p, {}) or {}).get("levels") or sorted(df[p].astype(str).unique().tolist())
            cat_series = pd.Categorical(df[p].astype(str), categories=cats, ordered=(ptype == "ordinal"))
            dummies = pd.get_dummies(cat_series, prefix=p, prefix_sep=": ", drop_first=True, dtype=float)
            X_parts.append(dummies)

    X = pd.concat(X_parts, axis=1)
    X = sm.add_constant(X, has_constant="add")
    X = X.rename(columns={"const": "Constante"})
    if len(X) <= X.shape[1] + 1:
        raise WorkerStatsError("Grados de libertad insuficientes respecto al número de parámetros.")
    return X, y, list(X.columns)


# =============================================================================
# 1. Estadística Descriptiva
# =============================================================================

def run_descriptives(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    vars_list = params.get("vars") or []
    table_rows: list[list[Any]] = []
    charts: list[dict[str, Any]] = []
    box_data: list[dict[str, Any]] = []
    warnings: list[str] = []
    conf = float(options.get("confLevel", 0.95))

    for col in vars_list:
        vals = extract_numeric_or_ordinal(rows, col, var_map)
        if not vals:
            continue
        arr = np.asarray(vals, dtype=float)
        n = int(arr.size)
        mean_v = float(np.mean(arr))
        sd_v = float(np.std(arr, ddof=1)) if n > 1 else 0.0
        se_v = sd_v / math.sqrt(n) if n > 1 else 0.0
        t_crit = float(sp_stats.t.ppf(1.0 - (1.0 - conf) / 2.0, n - 1)) if n > 1 else 0.0
        ci_lo, ci_hi = mean_v - t_crit * se_v, mean_v + t_crit * se_v
        med_v = float(np.median(arr))
        q1, q3 = np.percentile(arr, [25, 75])
        iqr_v = float(q3 - q1)
        skew_v = float(sp_stats.skew(arr, bias=False)) if n >= 3 and sd_v > 0 else 0.0
        sw_p = None
        if 3 <= n <= 5000 and sd_v > 0:
            _, p_sw = sp_stats.shapiro(arr)
            sw_p = float(p_sw)
            if sw_p < options.get("alpha", 0.05):
                warnings.append(f"'{col}' muestra desviación de la normalidad (Shapiro-Wilk p={fp(sw_p)}).")
        table_rows.append([
            col,
            n,
            len(rows) - n,
            rn(mean_v),
            rn(sd_v),
            f"{rn(ci_lo)} – {rn(ci_hi)}" if n > 1 else "—",
            rn(med_v),
            f"{rn(q1)} – {rn(q3)} (RIC {rn(iqr_v)})",
            f"{rn(float(np.min(arr)))} – {rn(float(np.max(arr)))}",
            rn(skew_v, 2),
            fp(sw_p) if sw_p is not None else "—",
        ])
        box_data.append({
            "group": col,
            "n": n,
            "min": rn(float(np.min(arr))),
            "q1": rn(float(q1)),
            "median": rn(med_v),
            "q3": rn(float(q3)),
            "max": rn(float(np.max(arr))),
            "mean": rn(mean_v),
        })
        if len(charts) == 0 and n >= 4:
            counts, edges = np.histogram(arr, bins=min(12, max(5, int(math.sqrt(n)))))
            hist_data = [
                {"bin": f"{rn(edges[i], 1)}–{rn(edges[i + 1], 1)}", "Frecuencia": int(counts[i])}
                for i in range(len(counts))
            ]
            charts.append({
                "type": "histogram",
                "title": f"Distribución de {col}",
                "x": "bin",
                "series": ["Frecuencia"],
                "data": hist_data,
                "meta": {},
            })

    if not table_rows:
        raise WorkerStatsError("No hay valores numéricos válidos en las variables seleccionadas.")
    if box_data:
        charts.append({
            "type": "box",
            "title": "Resumen de medianas y cuartiles",
            "x": "group",
            "series": ["median"],
            "data": box_data,
            "meta": {},
        })

    citations = build_library_citations([
        ("numpy", "Media, DE muestral (ddof=1), mediana y cuartiles"),
        ("scipy", "IC 95% de la media (t), asimetría y normalidad Shapiro-Wilk (scipy.stats)"),
    ])
    return {
        "result": {
            "test": "descriptives",
            "title": f"Estadística descriptiva ({len(table_rows)} variables)",
            "summary": f"Descriptivos cuantitativos, IC 95% y normalidad Shapiro-Wilk de {len(table_rows)} variable(s) (N={len(rows)}).",
            "tables": [{
                "title": "Descriptivos cuantitativos y normalidad",
                "columns": ["Variable", "N", "Perdidos", "Media", "DE", "IC 95% media", "Mediana", "Q1–Q3 (RIC)", "Mín–Máx", "Asimetría", "Shapiro-Wilk p"],
                "rows": table_rows,
                "note": "Shapiro-Wilk p < 0.05 sugiere asimetría/no normalidad; priorizar mediana, RIC y métodos no paramétricos.",
            }],
            "charts": charts,
        },
        "citations": citations,
        "warnings": warnings,
    }


def run_frequencies(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    col = params["var"]
    vals = [to_lbl(r.get(col)) for r in rows]
    valid = [v for v in vals if v is not None]
    if not valid:
        raise WorkerStatsError(f"La variable '{col}' no contiene valores válidos.")
    s = pd.Series(valid)
    vc = s.value_counts()
    total = int(len(valid))
    missing = len(rows) - total
    cum = 0.0
    table_rows = []
    chart_data = []
    for k, cnt in vc.items():
        pct = 100.0 * int(cnt) / total
        cum += pct
        table_rows.append([str(k), int(cnt), rn(100.0 * int(cnt) / len(rows), 1), rn(pct, 1), rn(cum, 1)])
        chart_data.append({"category": str(k), "Frecuencia": int(cnt)})

    citations = build_library_citations([
        ("pandas", "Tabulación de frecuencias absolutas, válidas y acumuladas (pandas.Series.value_counts)"),
    ])
    return {
        "result": {
            "test": "frequencies",
            "title": f"Frecuencias de {col}",
            "summary": f"N válido = {total} ({missing} perdidos), {len(vc)} categorías.",
            "tables": [{
                "title": f"Distribución de {col}",
                "columns": ["Categoría", "n", "% total", "% válido", "% acumulado"],
                "rows": table_rows,
                "note": f"Valores perdidos: {missing}." if missing else "",
            }],
            "charts": [
                {"type": "pie", "title": f"Proporción de {col}", "x": "category", "series": ["Frecuencia"], "data": chart_data, "meta": {}},
                {"type": "bar", "title": f"Frecuencias de {col}", "x": "category", "series": ["Frecuencia"], "data": chart_data, "meta": {}},
            ],
        },
        "citations": citations,
        "warnings": [],
    }


def run_table1(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    gv = params.get("group") or ""
    vars_list: list[str] = params.get("vars") or []
    if not vars_list:
        raise WorkerStatsError("Selecciona al menos una variable para la Tabla 1.")
    g_vals = [to_lbl(r.get(gv)) if gv else None for r in rows]
    levels = list(dict.fromkeys([g for g in g_vals if g is not None])) if gv else []

    cols = ["Variable", f"Total (N={len(rows)})"]
    for lv in levels:
        n_lv = sum(1 for g in g_vals if g == lv)
        cols.append(f"{lv} (n={n_lv})")
    if levels:
        cols.append("p")
        cols.append("Prueba aplicada")

    table_rows: list[list[Any]] = []
    alpha = float(options.get("alpha", 0.05))
    used_param = False
    used_nonparam = False

    def fmt_med_iqr(arr: np.ndarray) -> str:
        if arr.size == 0:
            return "—"
        return f"{rn(np.median(arr), 1)} ({rn(np.percentile(arr, 25), 1)}–{rn(np.percentile(arr, 75), 1)})"

    for v in vars_list:
        vtype = var_map.get(v, {}).get("type", "numeric")
        if vtype in ("numeric", "ordinal"):
            series = extract_aligned_series(rows, v, var_map)
            nums = np.asarray([x for x in series if x is not None], dtype=float)
            grp_arrs = [
                np.asarray([series[i] for i in range(len(rows)) if g_vals[i] == lv and series[i] is not None], dtype=float)
                for lv in levels
            ]
            non_normal = vtype == "ordinal"
            if not non_normal and 3 <= nums.size <= 5000 and float(np.std(nums, ddof=1)) > 0:
                if sp_stats.shapiro(nums).pvalue < alpha:
                    non_normal = True
            if not non_normal:
                for ga in grp_arrs:
                    if 3 <= ga.size <= 5000 and float(np.std(ga, ddof=1)) > 0:
                        if sp_stats.shapiro(ga).pvalue < alpha:
                            non_normal = True
                            break

            if non_normal:
                used_nonparam = True
                lbl = f"{v}, mediana (RIC) [ordinal]" if vtype == "ordinal" else f"{v}, mediana (RIC)"
                row_out: list[Any] = [lbl, fmt_med_iqr(nums)]
                if levels:
                    for ga in grp_arrs:
                        row_out.append(fmt_med_iqr(ga))
                    valid_g = [ga for ga in grp_arrs if ga.size > 0]
                    pv: float | None = None
                    test_lbl = "—"
                    if len(valid_g) == 2:
                        pv = float(sp_stats.mannwhitneyu(valid_g[0], valid_g[1], alternative="two-sided").pvalue)
                        test_lbl = "Mann-Whitney U"
                    elif len(valid_g) > 2:
                        pv = float(sp_stats.kruskal(*valid_g).pvalue)
                        test_lbl = "Kruskal-Wallis"
                    row_out.extend([fp(pv), test_lbl])
                table_rows.append(row_out)
            else:
                used_param = True
                tot_str = f"{rn(np.mean(nums), 1)} ± {rn(np.std(nums, ddof=1), 1)}" if nums.size > 1 else (str(rn(nums[0], 1)) if nums.size == 1 else "—")
                row_out = [f"{v}, media ± DE", tot_str]
                if levels:
                    for ga in grp_arrs:
                        row_out.append(f"{rn(np.mean(ga), 1)} ± {rn(np.std(ga, ddof=1), 1)}" if ga.size > 1 else "—")
                    valid_g = [ga for ga in grp_arrs if ga.size >= 2]
                    pv = None
                    test_lbl = "—"
                    if len(valid_g) == 2:
                        pv = float(sp_stats.ttest_ind(valid_g[0], valid_g[1], equal_var=False).pvalue)
                        test_lbl = "t de Welch"
                    elif len(valid_g) > 2:
                        pv = float(sp_stats.f_oneway(*valid_g).pvalue)
                        test_lbl = "ANOVA"
                    row_out.extend([fp(pv), test_lbl])
                table_rows.append(row_out)
        else:
            c_vals = [to_lbl(r.get(v)) for r in rows]
            c_levels = list(dict.fromkeys([c for c in c_vals if c is not None]))
            pv_cat: float | None = None
            test_lbl = "—"
            if levels:
                pairs = [(c_vals[i], g_vals[i]) for i in range(len(rows)) if c_vals[i] is not None and g_vals[i] is not None]
                if len(c_levels) >= 2 and len(levels) >= 2 and pairs:
                    ct = pd.crosstab(pd.Series([p[0] for p in pairs]), pd.Series([p[1] for p in pairs]))
                    if ct.shape == (2, 2):
                        _, f_p = sp_stats.fisher_exact(ct.values)
                        chi2_v, c_p, _, exp = sp_stats.chi2_contingency(ct.values, correction=False)
                        if (exp < 5).any():
                            pv_cat = float(f_p)
                            test_lbl = "Fisher exacto"
                        else:
                            pv_cat = float(c_p)
                            test_lbl = "χ² Pearson"
                    else:
                        _, c_p, _, _ = sp_stats.chi2_contingency(ct.values, correction=False)
                        pv_cat = float(c_p)
                        test_lbl = "χ² Pearson"
            table_rows.append([f"{v}, n (%)", "", *["" for _ in levels], *([fp(pv_cat), test_lbl] if levels else [])])
            n_valid = sum(1 for c in c_vals if c is not None)
            for cl in c_levels:
                cnt_tot = sum(1 for c in c_vals if c == cl)
                sub_row: list[Any] = [f"   {cl}", f"{cnt_tot} ({rn(100.0 * cnt_tot / max(1, n_valid), 1)}%)"]
                if levels:
                    for lv in levels:
                        sub = [c_vals[i] for i in range(len(rows)) if g_vals[i] == lv and c_vals[i] is not None]
                        cnt_g = sum(1 for c in sub if c == cl)
                        sub_row.append(f"{cnt_g} ({rn(100.0 * cnt_g / max(1, len(sub)), 1)}%)")
                    sub_row.extend(["", ""])
                table_rows.append(sub_row)

    notes = []
    if used_param:
        notes.append("Continuas normales: media ± DE (t de Welch / ANOVA).")
    if used_nonparam:
        notes.append("Ordinales o Shapiro-Wilk p < 0.05: mediana (RIC) con Mann-Whitney / Kruskal-Wallis.")
    notes.append("Categóricas: n (%) con χ² de Pearson o Fisher exacto.")

    citations = build_library_citations([
        ("scipy", "Pruebas automáticas Shapiro-Wilk, Welch t, Mann-Whitney, ANOVA, Kruskal-Wallis, χ² y Fisher (scipy.stats)"),
        ("pandas", "Tabulación cruzada de características basales (pandas.crosstab)"),
    ])
    return {
        "result": {
            "test": "table1",
            "title": f"Tabla 1: características basales{f' según {gv}' if gv else ''}",
            "summary": f"Tabla 1 con {len(vars_list)} variable(s){f' estratificada por {gv}' if gv else ''} (selección paramétrica/no paramétrica automática).",
            "tables": [{
                "title": "Tabla 1 (lista para manuscrito)",
                "columns": cols,
                "rows": table_rows,
                "note": " ".join(notes),
            }],
            "charts": [],
        },
        "citations": citations,
        "warnings": [],
    }


def run_outlier_detection(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    vars_list: list[str] = params.get("vars") or []
    z_thr = float(params.get("z_threshold", 3.0))
    if not vars_list:
        raise WorkerStatsError("Selecciona al menos una variable numérica para detectar valores atípicos.")

    summary_rows: list[list[Any]] = []
    detail_rows: list[list[Any]] = []
    chart_data: list[dict[str, Any]] = []
    box_data: list[dict[str, Any]] = []

    for col in vars_list:
        aligned = extract_aligned_series(rows, col, var_map)
        valid_pairs = [(idx + 1, float(val)) for idx, val in enumerate(aligned) if val is not None]
        if len(valid_pairs) < 4:
            continue
        arr = np.asarray([p[1] for p in valid_pairs], dtype=float)
        n = int(arr.size)
        q1, q3 = np.percentile(arr, [25, 75])
        iqr = float(q3 - q1)
        lo_15, hi_15 = float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)
        lo_30, hi_30 = float(q1 - 3.0 * iqr), float(q3 + 3.0 * iqr)
        mu, sd_v = float(np.mean(arr)), float(np.std(arr, ddof=1))
        med = float(np.median(arr))
        mad = float(np.median(np.abs(arr - med)))

        iqr_mod = 0
        iqr_ext = 0
        z_out = 0
        mad_out = 0

        for row_num, val in valid_pairs:
            is_iqr15 = val < lo_15 or val > hi_15
            is_iqr30 = val < lo_30 or val > hi_30
            z_val = abs(val - mu) / sd_v if sd_v > 0 else 0.0
            mod_z = 0.6745 * abs(val - med) / mad if mad > 0 else 0.0
            if is_iqr15:
                iqr_mod += 1
            if is_iqr30:
                iqr_ext += 1
            if z_val > z_thr:
                z_out += 1
            if mod_z > 3.5:
                mad_out += 1
            if is_iqr15 or z_val > z_thr or mod_z > 3.5:
                criterios = []
                if is_iqr30:
                    criterios.append("IQR 3× (extremo)")
                elif is_iqr15:
                    criterios.append("IQR 1.5×")
                if z_val > z_thr:
                    criterios.append(f"|Z|>{rn(z_thr, 1)}")
                if mod_z > 3.5:
                    criterios.append("|MAD-Z|>3.5")
                if len(detail_rows) < 60:
                    detail_rows.append([col, row_num, rn(val, 3), rn(z_val, 2), rn(mod_z, 2), ", ".join(criterios)])

        # Grubbs two-sided test
        grubbs_p = None
        g_stat = 0.0
        if sd_v > 0 and n >= 5:
            g_stat = float(np.max(np.abs(arr - mu)) / sd_v)
            t_crit = float(sp_stats.t.ppf(1.0 - 0.05 / (2.0 * n), n - 2))
            g_crit = ((n - 1) / math.sqrt(n)) * math.sqrt((t_crit ** 2) / (n - 2 + t_crit ** 2))
            # Exact Bonferroni upper bound on Grubbs p-value from t distribution
            t2 = (g_stat ** 2 * n * (n - 2)) / max(1e-12, (n - 1) ** 2 - n * g_stat ** 2)
            if (n - 1) ** 2 - n * g_stat ** 2 <= 0:
                grubbs_p = 0.0001
            else:
                grubbs_p = min(1.0, 2.0 * n * float(sp_stats.t.sf(math.sqrt(max(0.0, t2)), n - 2)))
            _ = g_crit

        summary_rows.append([
            col,
            n,
            f"[{rn(lo_15, 2)}, {rn(hi_15, 2)}]",
            iqr_mod,
            iqr_ext,
            z_out,
            mad_out,
            f"G={rn(g_stat, 2)} (p={fp(grubbs_p)})" if grubbs_p is not None else "—",
        ])
        chart_data.append({"variable": col, "IQR 1.5×": iqr_mod, f"|Z|>{rn(z_thr, 1)}": z_out, "MAD-Z>3.5": mad_out})
        box_data.append({
            "group": col,
            "n": n,
            "min": rn(float(np.min(arr))),
            "q1": rn(float(q1)),
            "median": rn(med),
            "q3": rn(float(q3)),
            "max": rn(float(np.max(arr))),
            "mean": rn(mu),
        })

    if not summary_rows:
        raise WorkerStatsError("Se requieren al menos 4 observaciones numéricas válidas por variable.")

    tables = [{
        "title": "Resumen de valores atípicos por método",
        "columns": ["Variable", "N", "Cerca IQR (1.5×)", "Atípicos IQR 1.5×", "Extremos IQR 3×", f"|Z| > {rn(z_thr, 1)}", "|MAD-Z| > 3.5", "Test de Grubbs"],
        "rows": summary_rows,
        "note": "MAD-Z robusto (Iglewicz & Hoaglin) es preferible en distribuciones asimétricas.",
    }]
    if detail_rows:
        tables.append({
            "title": "Registros señalados (primeros 60)",
            "columns": ["Variable", "Fila #", "Valor", "|Z|", "|MAD-Z|", "Criterios"],
            "rows": detail_rows,
            "note": "Verifica en el CRF si corresponden a errores de captura o extremos clínicos reales antes de excluir.",
        })

    citations = build_library_citations([
        ("numpy", "Cercas de Tukey (IQR 1.5× / 3×), Z-score y Z modificado robusto basado en MAD"),
        ("scipy", "Prueba bilateral de valores extremos de Grubbs (scipy.stats.t)"),
    ])
    total_iqr = sum(int(r[3]) for r in summary_rows)
    return {
        "result": {
            "test": "outlier_detection",
            "title": f"Detección de valores atípicos ({len(summary_rows)} variables)",
            "summary": f"Evaluadas {len(summary_rows)} variable(s): {total_iqr} valor(es) fuera de cerca IQR 1.5×.",
            "tables": tables,
            "charts": [
                {"type": "groupedbar", "title": "Conteo de atípicos por criterio", "x": "variable", "series": ["IQR 1.5×", f"|Z|>{rn(z_thr, 1)}", "MAD-Z>3.5"], "data": chart_data, "meta": {}},
                {"type": "box", "title": "Dispersión y cuartiles", "x": "group", "series": ["median"], "data": box_data, "meta": {}},
            ],
        },
        "citations": citations,
        "warnings": [],
    }


def run_missing_analysis(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    vars_list: list[str] = params.get("vars") or list(var_map.keys())
    if not vars_list and rows:
        vars_list = list(rows[0].keys())
    if not vars_list:
        raise WorkerStatsError("No hay variables disponibles para analizar datos perdidos.")

    n_rows = len(rows)
    var_rows: list[list[Any]] = []
    chart_data: list[dict[str, Any]] = []
    miss_masks: dict[str, np.ndarray] = {}

    for col in vars_list:
        mask = np.asarray([is_missing(r.get(col)) for r in rows], dtype=bool)
        miss_masks[col] = mask
        n_miss = int(mask.sum())
        n_valid = n_rows - n_miss
        pct = 100.0 * n_miss / max(1, n_rows)
        status = "Completo" if n_miss == 0 else ("Leve (<5%)" if pct < 5 else ("Moderado (5–20%)" if pct < 20 else "Alto (≥20%)"))
        var_rows.append([col, n_valid, n_miss, f"{rn(pct, 1)}%", status])
        chart_data.append({"variable": col, "% perdidos": rn(pct, 1)})

    var_rows.sort(key=lambda x: float(str(x[3]).replace("%", "")), reverse=True)
    complete_cases = 0
    pattern_counts: dict[str, int] = {}
    for i in range(n_rows):
        missing_cols = [c for c in vars_list if miss_masks[c][i]]
        if not missing_cols:
            complete_cases += 1
            key = "Sin datos perdidos (caso completo)"
        else:
            key = ", ".join(missing_cols[:5]) + ("…" if len(missing_cols) > 5 else "")
        pattern_counts[key] = pattern_counts.get(key, 0) + 1

    sorted_patterns = sorted(pattern_counts.items(), key=lambda kv: kv[1], reverse=True)[:12]
    pattern_rows = [[pat, cnt, f"{rn(100.0 * cnt / max(1, n_rows), 1)}%"] for pat, cnt in sorted_patterns]

    # Pairwise missingness association check (MCAR diagnostic proxy)
    dep_warnings: list[str] = []
    cols_with_miss = [c for c in vars_list if 0 < miss_masks[c].sum() < n_rows]
    for i in range(min(8, len(cols_with_miss))):
        for j in range(i + 1, min(8, len(cols_with_miss))):
            c1, c2 = cols_with_miss[i], cols_with_miss[j]
            m1, m2 = miss_masks[c1], miss_masks[c2]
            tab = [[int((m1 & m2).sum()), int((m1 & ~m2).sum())], [int((~m1 & m2).sum()), int((~m1 & ~m2).sum())]]
            _, p_f = sp_stats.fisher_exact(tab)
            if p_f < 0.05:
                dep_warnings.append(f"La ausencia en '{c1}' y '{c2}' está correlacionada (Fisher p={fp(p_f)}, descarta MCAR puro).")

    total_cells = n_rows * len(vars_list)
    total_missing = sum(int(m.sum()) for m in miss_masks.values())
    global_pct = 100.0 * total_missing / max(1, total_cells)

    citations = build_library_citations([
        ("pandas", "Auditoría de completitud celular, casos completos y patrones de ausencia"),
        ("scipy", "Contraste exacto de Fisher de independencia entre patrones de ausencia (scipy.stats.fisher_exact)"),
    ])
    return {
        "result": {
            "test": "missing_analysis",
            "title": f"Análisis de datos perdidos ({len(vars_list)} variables)",
            "summary": f"Casos completos: {complete_cases}/{n_rows} ({rn(100.0 * complete_cases / max(1, n_rows), 1)}%); valores perdidos totales: {total_missing} ({rn(global_pct, 1)}%).",
            "tables": [
                {
                    "title": "Completitud por variable",
                    "columns": ["Variable", "Válidos (n)", "Perdidos (n)", "% perdidos", "Estado"],
                    "rows": var_rows,
                    "note": " ".join(dep_warnings[:3]) if dep_warnings else "No se detectó asociación significativa entre ausencias (compatible con patrón aleatorio).",
                },
                {
                    "title": "Patrones frecuentes de valores perdidos",
                    "columns": ["Combinación de variables ausentes", "Registros (n)", "% cohorte"],
                    "rows": pattern_rows,
                    "note": "Si el porcentaje supera 5–10% con asociación MAR, considera imputación múltiple o análisis de sensibilidad.",
                },
            ],
            "charts": [{
                "type": "bar",
                "title": "Porcentaje de datos perdidos por variable (%)",
                "x": "variable",
                "series": ["% perdidos"],
                "data": sorted(chart_data, key=lambda d: float(d["% perdidos"]), reverse=True)[:15],
                "meta": {},
            }],
        },
        "citations": citations,
        "warnings": dep_warnings[:5],
    }


# =============================================================================
# 2. Comparación de Grupos
# =============================================================================

def run_ttest(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    outcome, group = params["outcome"], params["group"]
    grouped: dict[str, list[float]] = {}
    for r in rows:
        g = to_lbl(r.get(group))
        y = to_num(r.get(outcome))
        if g is not None and y is not None:
            grouped.setdefault(g, []).append(y)
    if len(grouped) != 2:
        raise WorkerStatsError(f"La prueba t requiere exactamente 2 grupos en '{group}' (encontrados: {len(grouped)}).")
    g_names = list(grouped.keys())
    a = np.asarray(grouped[g_names[0]], dtype=float)
    b = np.asarray(grouped[g_names[1]], dtype=float)
    if a.size < 2 or b.size < 2:
        raise WorkerStatsError("Cada grupo requiere al menos 2 observaciones.")

    _, lev_p = sp_stats.levene(a, b, center="median")
    equal_var = bool(lev_p >= 0.05)
    t_res = sp_stats.ttest_ind(a, b, equal_var=equal_var)
    t_stat = float(t_res.statistic)
    p_val = float(t_res.pvalue)
    df_val = float(getattr(t_res, "df", a.size + b.size - 2))
    diff = float(np.mean(a) - np.mean(b))
    se_diff = math.sqrt(float(np.var(a, ddof=1)) / a.size + float(np.var(b, ddof=1)) / b.size) if not equal_var else (
        math.sqrt(((a.size - 1) * float(np.var(a, ddof=1)) + (b.size - 1) * float(np.var(b, ddof=1))) / (a.size + b.size - 2))
        * math.sqrt(1.0 / a.size + 1.0 / b.size)
    )
    t_crit = float(sp_stats.t.ppf(1.0 - (1.0 - options.get("confLevel", 0.95)) / 2.0, df_val))
    ci_lo, ci_hi = diff - t_crit * se_diff, diff + t_crit * se_diff
    pooled_sd = math.sqrt(((a.size - 1) * float(np.var(a, ddof=1)) + (b.size - 1) * float(np.var(b, ddof=1))) / (a.size + b.size - 2))
    cohens_d = diff / pooled_sd if pooled_sd > 0 else 0.0

    warnings: list[str] = []
    if var_map.get(outcome, {}).get("type") == "ordinal":
        warnings.append(f"⚠ '{outcome}' está marcada como ordinal; considera la prueba U de Mann-Whitney.")
    for name_g, arr_g in [(g_names[0], a), (g_names[1], b)]:
        if 3 <= arr_g.size <= 5000 and float(np.std(arr_g, ddof=1)) > 0:
            _, p_sw = sp_stats.shapiro(arr_g)
            if p_sw < 0.05:
                warnings.append(f"El grupo '{name_g}' muestra no normalidad (Shapiro-Wilk p={fp(p_sw)}).")

    box_data = [
        {"group": g_names[0], "n": int(a.size), "min": rn(float(np.min(a))), "q1": rn(float(np.percentile(a, 25))), "median": rn(float(np.median(a))), "q3": rn(float(np.percentile(a, 75))), "max": rn(float(np.max(a))), "mean": rn(float(np.mean(a)))},
        {"group": g_names[1], "n": int(b.size), "min": rn(float(np.min(b))), "q1": rn(float(np.percentile(b, 25))), "median": rn(float(np.median(b))), "q3": rn(float(np.percentile(b, 75))), "max": rn(float(np.max(b))), "mean": rn(float(np.mean(b)))},
    ]
    citations = build_library_citations([
        ("scipy", f"Prueba t de {'Student (varianzas iguales)' if equal_var else 'Welch'}, Levene y Shapiro-Wilk (scipy.stats)"),
        ("numpy", "Medias, varianzas y d de Cohen"),
    ])
    return {
        "result": {
            "test": "ttest",
            "title": f"Prueba t: {outcome} según {group}",
            "summary": f"t({rn(df_val, 1)}) = {rn(t_stat, 3)}, p = {fp(p_val)}, Δ = {rn(diff)} (IC95%: {rn(ci_lo)} a {rn(ci_hi)}), d = {rn(cohens_d, 2)}.",
            "tables": [
                {
                    "title": "Estadísticos por grupo",
                    "columns": ["Grupo", "N", "Media", "DE", "Mediana (Q1–Q3)"],
                    "rows": [
                        [g_names[0], int(a.size), rn(float(np.mean(a))), rn(float(np.std(a, ddof=1))), f"{rn(float(np.median(a)))} ({rn(float(np.percentile(a, 25)))}–{rn(float(np.percentile(a, 75)))})"],
                        [g_names[1], int(b.size), rn(float(np.mean(b))), rn(float(np.std(b, ddof=1))), f"{rn(float(np.median(b)))} ({rn(float(np.percentile(b, 25)))}–{rn(float(np.percentile(b, 75)))})"],
                    ],
                    "note": f"Prueba de Levene de igualdad de varianzas: p = {fp(lev_p)}.",
                },
                {
                    "title": f"Contraste de hipótesis ({'Student' if equal_var else 'Welch'})",
                    "columns": ["t", "gl", "p", "Diferencia", "IC95% inf", "IC95% sup", "d de Cohen"],
                    "rows": [[rn(t_stat, 3), rn(df_val, 1), fp(p_val), rn(diff), rn(ci_lo), rn(ci_hi), rn(cohens_d, 3)]],
                    "note": ("⚠ " + " ".join(warnings)) if warnings else "",
                },
            ],
            "charts": [{"type": "box", "title": f"{outcome} por {group}", "x": "group", "series": ["median"], "data": box_data, "meta": {}}],
        },
        "citations": citations,
        "warnings": warnings,
    }


def run_paired_ttest(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    v1, v2 = params["var1"], params["var2"]
    s1 = extract_aligned_series(rows, v1, var_map)
    s2 = extract_aligned_series(rows, v2, var_map)
    valid = [(a, b) for a, b in zip(s1, s2) if a is not None and b is not None]
    if len(valid) < 2:
        raise WorkerStatsError("Se requieren al menos 2 pares completos para la prueba pareada.")
    a = np.asarray([x[0] for x in valid], dtype=float)
    b = np.asarray([x[1] for x in valid], dtype=float)
    d = b - a
    res = sp_stats.ttest_rel(b, a)
    t_stat = float(res.statistic)
    p_val = float(res.pvalue)
    n = int(len(valid))
    df_val = n - 1
    mean_d = float(np.mean(d))
    sd_d = float(np.std(d, ddof=1))
    se_d = sd_d / math.sqrt(n)
    t_crit = float(sp_stats.t.ppf(1.0 - (1.0 - options.get("confLevel", 0.95)) / 2.0, df_val))
    ci_lo, ci_hi = mean_d - t_crit * se_d, mean_d + t_crit * se_d
    dz = mean_d / sd_d if sd_d > 0 else 0.0

    wil_stat = 0.0
    wil_p = 1.0
    if np.any(d != 0):
        wres = sp_stats.wilcoxon(b, a)
        wil_stat = float(wres.statistic)
        wil_p = float(wres.pvalue)

    sw_p = float(sp_stats.shapiro(d).pvalue) if 3 <= n <= 5000 and sd_d > 0 else None
    is_ord = var_map.get(v1, {}).get("type") == "ordinal" or var_map.get(v2, {}).get("type") == "ordinal"
    warnings = []
    if is_ord or (sw_p is not None and sw_p < 0.05):
        warnings.append(f"⚠ Datos ordinales o diferencias no normales (Shapiro-Wilk p={fp(sw_p)}): priorizar Wilcoxon (W={rn(wil_stat, 1)}, p={fp(wil_p)}).")

    citations = build_library_citations([
        ("scipy", "Prueba t apareada (ttest_rel), Wilcoxon de rangos con signo (wilcoxon) y Shapiro-Wilk (scipy.stats)"),
    ])
    return {
        "result": {
            "test": "paired_ttest",
            "title": f"Contraste pareado (t / Wilcoxon): {v1} vs {v2}",
            "summary": f"t({df_val}) = {rn(t_stat, 3)}, p = {fp(p_val)}; Wilcoxon W = {rn(wil_stat, 1)}, p = {fp(wil_p)}; Δ medio = {rn(mean_d)} (IC95%: {rn(ci_lo)} a {rn(ci_hi)}), N = {n}.",
            "tables": [
                {
                    "title": "Descriptivos por momento",
                    "columns": ["Medida", "N", "Media ± DE", "Mediana (Q1–Q3)"],
                    "rows": [
                        [v1, n, f"{rn(np.mean(a), 2)} ± {rn(np.std(a, ddof=1), 2)}", f"{rn(np.median(a), 2)} ({rn(np.percentile(a, 25), 2)}–{rn(np.percentile(a, 75), 2)})"],
                        [v2, n, f"{rn(np.mean(b), 2)} ± {rn(np.std(b, ddof=1), 2)}", f"{rn(np.median(b), 2)} ({rn(np.percentile(b, 25), 2)}–{rn(np.percentile(b, 75), 2)})"],
                    ],
                    "note": "",
                },
                {
                    "title": "Pruebas pareadas (paramétrica y no paramétrica)",
                    "columns": ["Prueba", "Estadístico", "gl", "p", "Dif. media / mediana", "IC95% Δ", "Tamaño efecto (dz)"],
                    "rows": [
                        ["t de Student pareada", rn(t_stat, 3), df_val, fp(p_val), rn(mean_d), f"{rn(ci_lo)} – {rn(ci_hi)}", rn(dz, 3)],
                        ["Wilcoxon de rangos con signo", rn(wil_stat, 1), "—", fp(wil_p), rn(float(np.median(d))), "—", "—"],
                    ],
                    "note": " ".join(warnings) if warnings else f"Shapiro-Wilk diferencias: p = {fp(sw_p)}.",
                },
            ],
            "charts": [{
                "type": "box",
                "title": f"Distribución pareada: {v1} vs {v2}",
                "x": "group",
                "series": ["median"],
                "data": [
                    {"group": v1, "n": n, "min": rn(np.min(a)), "q1": rn(np.percentile(a, 25)), "median": rn(np.median(a)), "q3": rn(np.percentile(a, 75)), "max": rn(np.max(a)), "mean": rn(np.mean(a))},
                    {"group": v2, "n": n, "min": rn(np.min(b)), "q1": rn(np.percentile(b, 25)), "median": rn(np.median(b)), "q3": rn(np.percentile(b, 75)), "max": rn(np.max(b)), "mean": rn(np.mean(b))},
                ],
                "meta": {},
            }],
        },
        "citations": citations,
        "warnings": warnings,
    }


def run_mannwhitney(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    outcome, group = params["outcome"], params["group"]
    series = extract_aligned_series(rows, outcome, var_map)
    grouped: dict[str, list[float]] = {}
    for i, r in enumerate(rows):
        g = to_lbl(r.get(group))
        y = series[i]
        if g is not None and y is not None:
            grouped.setdefault(g, []).append(y)
    if len(grouped) != 2:
        raise WorkerStatsError(f"Mann-Whitney requiere exactamente 2 grupos en '{group}'.")
    g_names = list(grouped.keys())
    a = np.asarray(grouped[g_names[0]], dtype=float)
    b = np.asarray(grouped[g_names[1]], dtype=float)
    res = sp_stats.mannwhitneyu(a, b, alternative="two-sided", method="auto")
    u_stat = float(res.statistic)
    p_val = float(res.pvalue)
    r_rb = 1.0 - (2.0 * u_stat) / (a.size * b.size)

    citations = build_library_citations([
        ("scipy", "Prueba U de Mann-Whitney bilateral con corrección de empates (scipy.stats.mannwhitneyu)"),
    ])
    return {
        "result": {
            "test": "mannwhitney",
            "title": f"U de Mann-Whitney: {outcome} según {group}",
            "summary": f"U = {rn(u_stat, 1)}, p = {fp(p_val)}, r biserial por rangos = {rn(r_rb, 3)}.",
            "tables": [{
                "title": "Comparación no paramétrica",
                "columns": ["Grupo", "N", "Mediana", "Q1", "Q3", "U", "p", "r biserial"],
                "rows": [
                    [g_names[0], int(a.size), rn(float(np.median(a))), rn(float(np.percentile(a, 25))), rn(float(np.percentile(a, 75))), rn(u_stat, 1), fp(p_val), rn(r_rb, 3)],
                    [g_names[1], int(b.size), rn(float(np.median(b))), rn(float(np.percentile(b, 25))), rn(float(np.percentile(b, 75))), "—", "—", "—"],
                ],
                "note": "",
            }],
            "charts": [{
                "type": "box",
                "title": f"{outcome} por {group}",
                "x": "group",
                "series": ["median"],
                "data": [
                    {"group": g_names[0], "n": int(a.size), "min": rn(float(np.min(a))), "q1": rn(float(np.percentile(a, 25))), "median": rn(float(np.median(a))), "q3": rn(float(np.percentile(a, 75))), "max": rn(float(np.max(a))), "mean": rn(float(np.mean(a)))},
                    {"group": g_names[1], "n": int(b.size), "min": rn(float(np.min(b))), "q1": rn(float(np.percentile(b, 25))), "median": rn(float(np.median(b))), "q3": rn(float(np.percentile(b, 75))), "max": rn(float(np.max(b))), "mean": rn(float(np.mean(b)))},
                ],
                "meta": {},
            }],
        },
        "citations": citations,
        "warnings": [],
    }


def run_chi2(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    r_col, c_col = params["row"], params["col"]
    pairs = [(to_lbl(r.get(r_col)), to_lbl(r.get(c_col))) for r in rows]
    valid = [(a, b) for a, b in pairs if a is not None and b is not None]
    if not valid:
        raise WorkerStatsError("No hay pares válidos para la tabla de contingencia.")
    df = pd.DataFrame(valid, columns=[r_col, c_col])
    ct = pd.crosstab(df[r_col], df[c_col])
    if ct.shape[0] < 2 or ct.shape[1] < 2:
        raise WorkerStatsError("Se requieren al menos 2 categorías en ambas variables.")
    chi2_val, p_val, dof, expected = sp_stats.chi2_contingency(ct, correction=False)
    n = int(ct.values.sum())
    min_dim = min(ct.shape[0] - 1, ct.shape[1] - 1)
    cramers_v = math.sqrt(chi2_val / (n * min_dim)) if n * min_dim > 0 else 0.0
    fisher_p = None
    if ct.shape == (2, 2):
        _, f_p = sp_stats.fisher_exact(ct.values)
        fisher_p = float(f_p)
    low_exp = int((expected < 5).sum())

    citations = build_library_citations([
        ("scipy", "Prueba χ² de Pearson y test exacto de Fisher 2×2 (scipy.stats.chi2_contingency, fisher_exact)"),
        ("pandas", "Tabla de contingencia (pandas.crosstab)"),
    ])
    table_rows = [[str(idx), *[int(ct.loc[idx, c]) for c in ct.columns]] for idx in ct.index]
    chart_data = [{"group": str(idx), **{str(c): int(ct.loc[idx, c]) for c in ct.columns}} for idx in ct.index]
    return {
        "result": {
            "test": "chi2",
            "title": f"Contingencia χ²: {r_col} × {c_col}",
            "summary": f"χ²({dof}) = {rn(chi2_val, 3)}, p = {fp(p_val)}, V de Cramér = {rn(cramers_v, 3)}"
            + (f", p Fisher exacto = {fp(fisher_p)}" if fisher_p is not None else "") + f" (N = {n}).",
            "tables": [
                {"title": "Tabla de contingencia (conteos observados)", "columns": [r_col, *[str(c) for c in ct.columns]], "rows": table_rows, "note": ""},
                {
                    "title": "Prueba de asociación",
                    "columns": ["χ² Pearson", "gl", "p (χ²)", "p Fisher exacto", "V de Cramér", "Celdas E<5"],
                    "rows": [[rn(chi2_val, 3), int(dof), fp(p_val), fp(fisher_p) if fisher_p is not None else "—", rn(cramers_v, 3), low_exp]],
                    "note": "⚠ >20% de celdas con frecuencia esperada < 5: priorizar Fisher exacto." if low_exp > 0 and low_exp / expected.size > 0.2 else "",
                },
            ],
            "charts": [{"type": "groupedbar", "title": f"{r_col} vs {c_col}", "x": "group", "series": [str(c) for c in ct.columns], "data": chart_data, "meta": {}}],
        },
        "citations": citations,
        "warnings": [],
    }


def run_anova(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    outcome, group = params["outcome"], params["group"]
    series = extract_aligned_series(rows, outcome, var_map)
    grouped: dict[str, list[float]] = {}
    all_y: list[float] = []
    all_g: list[str] = []
    for i, r in enumerate(rows):
        g = to_lbl(r.get(group))
        y = series[i]
        if g is not None and y is not None:
            grouped.setdefault(g, []).append(y)
            all_y.append(y)
            all_g.append(g)
    if len(grouped) < 2:
        raise WorkerStatsError("ANOVA requiere al menos 2 grupos.")
    g_keys = list(grouped.keys())
    arrays = [np.asarray(grouped[k], dtype=float) for k in g_keys]
    f_stat, p_val = sp_stats.f_oneway(*arrays)
    kw_stat, kw_p = sp_stats.kruskal(*arrays)
    all_vals = np.concatenate(arrays)
    grand_mean = float(np.mean(all_vals))
    ss_between = sum(arr.size * (float(np.mean(arr)) - grand_mean) ** 2 for arr in arrays)
    ss_total = float(np.sum((all_vals - grand_mean) ** 2))
    ss_within = ss_total - ss_between
    k = len(arrays)
    n_tot = int(all_vals.size)
    ms_within = ss_within / max(1, n_tot - k)
    eta2 = ss_between / ss_total if ss_total > 0 else 0.0
    omega2 = max(0.0, (ss_between - (k - 1) * ms_within) / (ss_total + ms_within)) if ss_total + ms_within > 0 else 0.0

    warnings: list[str] = []
    if var_map.get(outcome, {}).get("type") == "ordinal":
        warnings.append(f"⚠ '{outcome}' es ordinal; priorizar Kruskal-Wallis (H={rn(float(kw_stat), 2)}, p={fp(float(kw_p))}) y post-hoc no paramétrico de Holm.")
    for gk, arr in zip(g_keys, arrays):
        if 3 <= arr.size <= 5000 and float(np.std(arr, ddof=1)) > 0:
            sw_p = float(sp_stats.shapiro(arr).pvalue)
            if sw_p < 0.05:
                warnings.append(f"Grupo '{gk}' no normal (Shapiro-Wilk p={fp(sw_p)}).")

    tables: list[dict[str, Any]] = [
        {
            "title": "Resumen por grupo",
            "columns": ["Grupo", "N", "Media", "DE", "Mediana (Q1–Q3)"],
            "rows": [
                [g, len(grouped[g]), rn(float(np.mean(grouped[g]))), rn(float(np.std(grouped[g], ddof=1))) if len(grouped[g]) > 1 else 0.0, f"{rn(float(np.median(grouped[g])))} ({rn(float(np.percentile(grouped[g], 25)))}–{rn(float(np.percentile(grouped[g], 75)))})"]
                for g in g_keys
            ],
            "note": "",
        },
        {
            "title": "Contraste global (ANOVA / Kruskal-Wallis)",
            "columns": ["F", "p (ANOVA)", "η²", "ω²", "H (Kruskal-Wallis)", "p (KW)"],
            "rows": [[rn(float(f_stat), 3), fp(float(p_val)), rn(eta2, 3), rn(omega2, 3), rn(float(kw_stat), 3), fp(float(kw_p))]],
            "note": " ".join(warnings),
        },
    ]

    if k > 2 and n_tot > k:
        tuk = pairwise_tukeyhsd(np.asarray(all_y, dtype=float), np.asarray(all_g, dtype=object))
        tuk_rows = []
        for row_t in tuk.summary().data[1:]:
            tuk_rows.append([str(row_t[0]), str(row_t[1]), rn(float(row_t[2]), 3), fp(float(row_t[3])), rn(float(row_t[4]), 3), rn(float(row_t[5]), 3), "Sí" if bool(row_t[6]) else "No"])
        tables.append({
            "title": "Post hoc paramétrico: Tukey HSD",
            "columns": ["Grupo 1", "Grupo 2", "Dif. media", "p ajustada", "IC95% inf", "IC95% sup", "Rechaza H0"],
            "rows": tuk_rows,
            "note": "",
        })

        # Non-parametric pairwise Mann-Whitney with Holm correction
        raw_pairs = []
        raw_pvals = []
        for i in range(k):
            for j in range(i + 1, k):
                _, mp = sp_stats.mannwhitneyu(arrays[i], arrays[j], alternative="two-sided")
                raw_pairs.append((g_keys[i], g_keys[j], float(np.median(arrays[j]) - np.median(arrays[i])), float(mp)))
                raw_pvals.append(float(mp))
        rej, p_holm, _, _ = multipletests(raw_pvals, alpha=0.05, method="holm")
        tables.append({
            "title": "Post hoc no paramétrico: pares Mann-Whitney (ajuste de Holm)",
            "columns": ["Grupo 1", "Grupo 2", "Dif. medianas", "p bruta", "p Holm", "Significativo"],
            "rows": [[g1, g2, rn(dm, 3), fp(pb), fp(float(ph)), "Sí" if bool(rj) else "No"] for (g1, g2, dm, pb), ph, rj in zip(raw_pairs, p_holm, rej)],
            "note": "Controla error tipo I familiar sin requerir normalidad.",
        })

    citations = build_library_citations([
        ("scipy", "ANOVA de un factor (f_oneway), Kruskal-Wallis H y Mann-Whitney U (scipy.stats)"),
        ("statsmodels", "Comparaciones múltiples Tukey HSD (pairwise_tukeyhsd) y corrección de Holm (multipletests)"),
    ])
    return {
        "result": {
            "test": "anova",
            "title": f"ANOVA / Kruskal-Wallis: {outcome} según {group}",
            "summary": f"F = {rn(float(f_stat), 3)}, p = {fp(float(p_val))}, η² = {rn(eta2, 3)}; Kruskal-Wallis H = {rn(float(kw_stat), 2)}, p = {fp(float(kw_p))}.",
            "tables": tables,
            "charts": [{
                "type": "box",
                "title": f"{outcome} por {group}",
                "x": "group",
                "series": ["median"],
                "data": [
                    {"group": g, "n": len(grouped[g]), "min": rn(float(np.min(grouped[g]))), "q1": rn(float(np.percentile(grouped[g], 25))), "median": rn(float(np.median(grouped[g]))), "q3": rn(float(np.percentile(grouped[g], 75))), "max": rn(float(np.max(grouped[g]))), "mean": rn(float(np.mean(grouped[g])))}
                    for g in g_keys
                ],
                "meta": {},
            }],
        },
        "citations": citations,
        "warnings": warnings,
    }


def run_rm_anova(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    vars_list: list[str] = params["vars"]
    if len(vars_list) < 3:
        raise WorkerStatsError("ANOVA de medidas repetidas requiere al menos 3 mediciones.")
    series_list = [extract_aligned_series(rows, v, var_map) for v in vars_list]
    complete: list[list[float]] = []
    for i in range(len(rows)):
        vals = [s[i] for s in series_list]
        if all(x is not None for x in vals):
            complete.append([float(x) for x in vals if x is not None])
    if len(complete) < 3:
        raise WorkerStatsError("Se necesitan al menos 3 sujetos con datos completos en todas las condiciones.")
    mat = np.asarray(complete, dtype=float)
    n, k = mat.shape

    long_recs = []
    for s_idx in range(n):
        for c_idx, cname in enumerate(vars_list):
            long_recs.append({"subject": str(s_idx), "condition": cname, "value": float(mat[s_idx, c_idx])})
    long_df = pd.DataFrame(long_recs)
    rm_res = AnovaRM(long_df, depvar="value", subject="subject", within=["condition"]).fit()
    tab = rm_res.anova_table
    f_val = float(tab["F Value"].iloc[0])
    df1 = float(tab["Num DF"].iloc[0])
    df2 = float(tab["Den DF"].iloc[0])
    p_val = float(tab["Pr > F"].iloc[0])

    # Partial eta squared + Greenhouse-Geisser epsilon
    grand = float(np.mean(mat))
    cond_means = np.mean(mat, axis=0)
    subj_means = np.mean(mat, axis=1)
    ss_cond = float(n * np.sum((cond_means - grand) ** 2))
    ss_subj = float(k * np.sum((subj_means - grand) ** 2))
    ss_tot = float(np.sum((mat - grand) ** 2))
    ss_err = max(1e-12, ss_tot - ss_cond - ss_subj)
    partial_eta2 = ss_cond / (ss_cond + ss_err) if (ss_cond + ss_err) > 0 else 0.0

    cov = np.cov(mat, rowvar=False, ddof=1)
    row_m = np.mean(cov, axis=1, keepdims=True)
    col_m = np.mean(cov, axis=0, keepdims=True)
    grand_c = float(np.mean(cov))
    dcov = cov - row_m - col_m + grand_c
    tr = float(np.trace(dcov))
    tr2 = float(np.sum(dcov * dcov))
    gg_eps = min(1.0, max(1.0 / (k - 1), (tr * tr) / ((k - 1) * tr2))) if tr2 > 0 else 1.0
    p_gg = float(sp_stats.f.sf(f_val, df1 * gg_eps, df2 * gg_eps))

    fr_stat, fr_p = sp_stats.friedmanchisquare(*[mat[:, i] for i in range(k)])

    # Post-hoc paired t-tests with Holm correction
    pair_info = []
    pair_pvals = []
    for i in range(k):
        for j in range(i + 1, k):
            t_r = sp_stats.ttest_rel(mat[:, j], mat[:, i])
            pair_info.append((vars_list[i], vars_list[j], float(np.mean(mat[:, j] - mat[:, i])), float(t_r.pvalue)))
            pair_pvals.append(float(t_r.pvalue))
    rej, p_holm, _, _ = multipletests(pair_pvals, alpha=0.05, method="holm")

    warnings = []
    if any(var_map.get(v, {}).get("type") == "ordinal" for v in vars_list):
        warnings.append(f"⚠ Contiene variables ordinales: priorizar Friedman χ² = {rn(float(fr_stat), 2)}, p = {fp(float(fr_p))}.")

    citations = build_library_citations([
        ("statsmodels", "ANOVA de medidas repetidas (statsmodels.stats.anova.AnovaRM) y ajuste de Holm"),
        ("scipy", "Corrección de esfericidad Greenhouse-Geisser y prueba de Friedman de contraste (scipy.stats)"),
    ])
    return {
        "result": {
            "test": "rm_anova",
            "title": f"ANOVA de medidas repetidas ({k} momentos)",
            "summary": f"F({rn(df1, 1)}, {rn(df2, 1)}) = {rn(f_val, 3)}, p = {fp(p_val)} (p Greenhouse-Geisser = {fp(p_gg)}, ε = {rn(gg_eps, 3)}), η² parcial = {rn(partial_eta2, 3)}.",
            "tables": [
                {
                    "title": "Descriptivos por momento / condición",
                    "columns": ["Condición", "N", "Media", "DE", "Mediana (Q1–Q3)"],
                    "rows": [
                        [v, n, rn(float(np.mean(mat[:, i]))), rn(float(np.std(mat[:, i], ddof=1))), f"{rn(float(np.median(mat[:, i])))} ({rn(float(np.percentile(mat[:, i], 25)))}–{rn(float(np.percentile(mat[:, i], 75)))})"]
                        for i, v in enumerate(vars_list)
                    ],
                    "note": "",
                },
                {
                    "title": "Prueba intra-sujeto y esfericidad",
                    "columns": ["F", "gl num", "gl den", "p (esfericidad asumida)", "ε Greenhouse-Geisser", "p (GG)", "η² parcial", "p Friedman ref."],
                    "rows": [[rn(f_val, 3), rn(df1, 1), rn(df2, 1), fp(p_val), rn(gg_eps, 3), fp(p_gg), rn(partial_eta2, 3), fp(float(fr_p))]],
                    "note": " ".join(warnings) if warnings else "Si se viola la esfericidad (ε < 0.75), reportar el valor p corregido de Greenhouse-Geisser.",
                },
                {
                    "title": "Comparaciones post hoc por pares (t pareada + corrección de Holm)",
                    "columns": ["Condición 1", "Condición 2", "Dif. media", "p bruta", "p Holm", "Significativo"],
                    "rows": [[c1, c2, rn(dm, 3), fp(pb), fp(float(ph)), "Sí" if bool(rj) else "No"] for (c1, c2, dm, pb), ph, rj in zip(pair_info, p_holm, rej)],
                    "note": "",
                },
            ],
            "charts": [{
                "type": "box",
                "title": "Trayectoria de medidas repetidas",
                "x": "group",
                "series": ["median"],
                "data": [
                    {"group": v, "n": n, "min": rn(float(np.min(mat[:, i]))), "q1": rn(float(np.percentile(mat[:, i], 25))), "median": rn(float(np.median(mat[:, i]))), "q3": rn(float(np.percentile(mat[:, i], 75))), "max": rn(float(np.max(mat[:, i]))), "mean": rn(float(np.mean(mat[:, i])))}
                    for i, v in enumerate(vars_list)
                ],
                "meta": {},
            }],
        },
        "citations": citations,
        "warnings": warnings,
    }


def run_friedman(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    vars_list: list[str] = params["vars"]
    if len(vars_list) < 3:
        raise WorkerStatsError("Friedman requiere al menos 3 medidas repetidas.")
    series_list = [extract_aligned_series(rows, v, var_map) for v in vars_list]
    complete = [[float(s[i]) for s in series_list] for i in range(len(rows)) if all(s[i] is not None for s in series_list)]
    if len(complete) < 3:
        raise WorkerStatsError("Casos completos insuficientes para la prueba de Friedman.")
    mat = np.asarray(complete, dtype=float)
    stat, p_val = sp_stats.friedmanchisquare(*[mat[:, i] for i in range(mat.shape[1])])
    n, k = mat.shape
    kendall_w = float(stat) / (n * (k - 1)) if n * (k - 1) > 0 else 0.0

    pair_info = []
    pair_pvals = []
    for i in range(k):
        for j in range(i + 1, k):
            diff = mat[:, j] - mat[:, i]
            pw = float(sp_stats.wilcoxon(mat[:, j], mat[:, i]).pvalue) if np.any(diff != 0) else 1.0
            pair_info.append((vars_list[i], vars_list[j], float(np.median(diff)), pw))
            pair_pvals.append(pw)
    rej, p_holm, _, _ = multipletests(pair_pvals, alpha=0.05, method="holm")

    citations = build_library_citations([
        ("scipy", "Prueba de Friedman y Wilcoxon pareado post hoc (scipy.stats)"),
        ("statsmodels", "Ajuste de multiplicidad de Holm (statsmodels.stats.multitest.multipletests)"),
    ])
    return {
        "result": {
            "test": "friedman",
            "title": f"Prueba de Friedman ({k} medidas)",
            "summary": f"χ² de Friedman({k - 1}) = {rn(float(stat), 2)}, p = {fp(float(p_val))}, W de Kendall = {rn(kendall_w, 3)} (N = {n}).",
            "tables": [
                {
                    "title": "Medianas y rango intercuartílico",
                    "columns": ["Medida", "N", "Mediana", "Q1", "Q3"],
                    "rows": [[v, n, rn(float(np.median(mat[:, i]))), rn(float(np.percentile(mat[:, i], 25))), rn(float(np.percentile(mat[:, i], 75)))] for i, v in enumerate(vars_list)],
                    "note": f"χ² = {rn(float(stat), 3)}, gl = {k - 1}, p = {fp(float(p_val))}, W de Kendall = {rn(kendall_w, 3)}.",
                },
                {
                    "title": "Post hoc no paramétrico: Wilcoxon pareado (corrección de Holm)",
                    "columns": ["Medida 1", "Medida 2", "Mediana Δ", "p bruta", "p Holm", "Significativo"],
                    "rows": [[c1, c2, rn(dm, 3), fp(pb), fp(float(ph)), "Sí" if bool(rj) else "No"] for (c1, c2, dm, pb), ph, rj in zip(pair_info, p_holm, rej)],
                    "note": "",
                },
            ],
            "charts": [{
                "type": "box",
                "title": "Comparación de medidas repetidas",
                "x": "group",
                "series": ["median"],
                "data": [
                    {"group": v, "n": n, "min": rn(float(np.min(mat[:, i]))), "q1": rn(float(np.percentile(mat[:, i], 25))), "median": rn(float(np.median(mat[:, i]))), "q3": rn(float(np.percentile(mat[:, i], 75))), "max": rn(float(np.max(mat[:, i]))), "mean": rn(float(np.mean(mat[:, i])))}
                    for i, v in enumerate(vars_list)
                ],
                "meta": {},
            }],
        },
        "citations": citations,
        "warnings": [],
    }


def run_mcnemar(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    v1, v2 = params["var1"], params["var2"]
    b1, l1_p, _ = resolve_binary_series(rows, v1)
    b2, l2_p, _ = resolve_binary_series(rows, v2)
    valid = [(a, b) for a, b in zip(b1, b2) if a is not None and b is not None]
    if len(valid) < 2:
        raise WorkerStatsError("Se requieren observaciones binarias válidas en ambas variables para McNemar.")
    a11 = sum(1 for x, y in valid if x == 1 and y == 1)
    a10 = sum(1 for x, y in valid if x == 1 and y == 0)
    a01 = sum(1 for x, y in valid if x == 0 and y == 1)
    a00 = sum(1 for x, y in valid if x == 0 and y == 0)
    table = [[a11, a10], [a01, a00]]
    exact = (a10 + a01) < 25
    res = sm_mcnemar(table, exact=exact, correction=not exact)
    citations = build_library_citations([
        ("statsmodels", "Prueba de McNemar para proporciones apareadas (statsmodels.stats.contingency_tables.mcnemar)"),
    ])
    return {
        "result": {
            "test": "mcnemar",
            "title": f"Prueba de McNemar: {v1} ({l1_p}) vs {v2} ({l2_p})",
            "summary": f"Discordantes b={a10}, c={a01}; estadístico = {rn(float(res.statistic), 3)}, p = {fp(float(res.pvalue))} ({'exacto binomial' if exact else 'asintótico con corrección de continuidad'}).",
            "tables": [{
                "title": "Tabla 2×2 apareada y prueba de McNemar",
                "columns": ["N pares", "Concordantes +/+", "Discordantes +/-", "Discordantes -/+", "Concordantes -/-", "Método", "p"],
                "rows": [[len(valid), a11, a10, a01, a00, "Exacto binomial" if exact else "χ² McNemar (Yates)", fp(float(res.pvalue))]],
                "note": "",
            }],
            "charts": [],
        },
        "citations": citations,
        "warnings": [],
    }


# =============================================================================
# 3. Correlación y Asociación
# =============================================================================

def run_correlation(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    vars_list: list[str] = params["vars"]
    method = params.get("method", "pearson")
    has_ordinal = any(var_map.get(v, {}).get("type") == "ordinal" for v in vars_list)
    if has_ordinal and method == "pearson":
        method = "spearman"

    aligned = {v: extract_aligned_series(rows, v, var_map) for v in vars_list}
    pair_rows: list[list[Any]] = []
    heat_data: list[dict[str, Any]] = []
    scatter_charts: list[dict[str, Any]] = []

    for i, v1 in enumerate(vars_list):
        for j, v2 in enumerate(vars_list):
            if i == j:
                heat_data.append({"rowVar": v1, "colVar": v2, "r": 1.0, "p": 0.0})
                continue
            vals = [(aligned[v1][k], aligned[v2][k]) for k in range(len(rows)) if aligned[v1][k] is not None and aligned[v2][k] is not None]
            if len(vals) < 3:
                heat_data.append({"rowVar": v1, "colVar": v2, "r": None, "p": None})
                continue
            xa = np.asarray([x[0] for x in vals], dtype=float)
            xb = np.asarray([x[1] for x in vals], dtype=float)
            if method == "spearman":
                res = sp_stats.spearmanr(xa, xb)
            elif method == "kendall":
                res = sp_stats.kendalltau(xa, xb)
            else:
                res = sp_stats.pearsonr(xa, xb)
            coef = float(res.statistic)
            pval = float(res.pvalue)
            ci_str = "—"
            if len(vals) >= 4 and abs(coef) < 0.9999 and method != "kendall":
                z = 0.5 * math.log((1.0 + coef) / (1.0 - coef))
                se_z = 1.0 / math.sqrt(len(vals) - 3)
                ci_str = f"{rn(math.tanh(z - 1.96 * se_z), 3)} – {rn(math.tanh(z + 1.96 * se_z), 3)}"
            heat_data.append({"rowVar": v1, "colVar": v2, "r": rn(coef, 3), "p": rn(pval, 4)})
            if i < j:
                pair_rows.append([f"{v1} × {v2}", len(vals), rn(coef, 3), ci_str, fp(pval)])
                if len(scatter_charts) == 0:
                    slope, intercept = np.polyfit(xa, xb, 1) if np.std(xa) > 0 else (0.0, float(np.mean(xb)))
                    scatter_charts.append({
                        "type": "scatter",
                        "title": f"{v2} vs {v1} ({method}: {rn(coef, 3)}, p={fp(pval)})",
                        "x": "x",
                        "series": ["y"],
                        "data": [{"x": rn(float(xa[idx])), "y": rn(float(xb[idx]))} for idx in range(min(800, len(xa)))],
                        "meta": {"slope": rn(float(slope), 4), "intercept": rn(float(intercept), 4), "xlabel": v1, "ylabel": v2, "xmin": rn(float(np.min(xa))), "xmax": rn(float(np.max(xa)))},
                    })

    citations = build_library_citations([
        ("scipy", f"Correlación de {method} (scipy.stats.{'spearmanr' if method == 'spearman' else 'kendalltau' if method == 'kendall' else 'pearsonr'})"),
    ])
    charts = [*scatter_charts, {"type": "heatmap", "title": f"Mapa de calor ({method})", "x": "colVar", "series": vars_list, "data": heat_data, "meta": {"method": method}}]
    return {
        "result": {
            "test": "correlation",
            "title": f"Correlación ({method.capitalize()})",
            "summary": f"Correlaciones por pares ({method}) entre {len(vars_list)} variables.",
            "tables": [{
                "title": f"Correlaciones por pares ({method})",
                "columns": ["Par de variables", "N", "Coeficiente", "IC 95%", "p"],
                "rows": pair_rows,
                "note": "Cambio automático a Spearman por inclusión de variable ordinal." if has_ordinal else "",
            }],
            "charts": charts,
        },
        "citations": citations,
        "warnings": [],
    }


def run_kappa(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    v1, v2 = params["var1"], params["var2"]
    pairs = [(to_lbl(r.get(v1)), to_lbl(r.get(v2))) for r in rows]
    valid = [(a, b) for a, b in pairs if a is not None and b is not None]
    if len(valid) < 2:
        raise WorkerStatsError("Se requieren al menos 2 observaciones válidas para κ de Cohen.")
    df = pd.DataFrame(valid, columns=[v1, v2])
    cats = sorted(set(df[v1]).union(set(df[v2])))
    ct = pd.crosstab(pd.Categorical(df[v1], categories=cats), pd.Categorical(df[v2], categories=cats), dropna=False)
    res = cohens_kappa(ct.to_numpy())
    k_val = float(res.kappa)
    se = float(res.std_kappa)
    ci_lo, ci_hi = k_val - 1.96 * se, k_val + 1.96 * se
    obs_agree = float(np.trace(ct.to_numpy()) / len(valid))
    citations = build_library_citations([
        ("statsmodels", "Concordancia κ de Cohen e IC 95% (statsmodels.stats.inter_rater.cohens_kappa)"),
    ])
    return {
        "result": {
            "test": "kappa_agreement",
            "title": f"Concordancia κ de Cohen: {v1} vs {v2}",
            "summary": f"κ = {rn(k_val, 3)} (IC95%: {rn(ci_lo, 3)}–{rn(ci_hi, 3)}), acuerdo observado = {rn(obs_agree * 100, 1)}% (N = {len(valid)}).",
            "tables": [{
                "title": "Estimación de concordancia interobservador",
                "columns": ["N", "Acuerdo observado", "κ de Cohen", "EE", "IC 95% κ"],
                "rows": [[len(valid), f"{rn(obs_agree * 100, 1)}%", rn(k_val, 3), rn(se, 3), f"{rn(ci_lo, 3)} – {rn(ci_hi, 3)}"]],
                "note": "Interpretación Landis & Koch: <0.20 leve, 0.21–0.40 aceptable, 0.41–0.60 moderada, 0.61–0.80 sustancial, >0.80 casi perfecta.",
            }],
            "charts": [],
        },
        "citations": citations,
        "warnings": [],
    }


def run_icc(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    vars_list: list[str] = params["vars"]
    icc_type = params.get("icc_type", "agreement")
    if len(vars_list) < 2:
        raise WorkerStatsError("ICC requiere al menos 2 evaluadores o mediciones numéricas.")
    series_list = [extract_aligned_series(rows, v, var_map) for v in vars_list]
    complete = [[float(s[i]) for s in series_list] for i in range(len(rows)) if all(s[i] is not None for s in series_list)]
    if len(complete) < 3:
        raise WorkerStatsError("Se necesitan al menos 3 sujetos con mediciones completas en todos los evaluadores.")
    Y = np.asarray(complete, dtype=float)
    n, k = Y.shape
    grand = float(np.mean(Y))
    row_means = np.mean(Y, axis=1)
    col_means = np.mean(Y, axis=0)
    ss_total = float(np.sum((Y - grand) ** 2))
    ss_rows = float(k * np.sum((row_means - grand) ** 2))
    ss_cols = float(n * np.sum((col_means - grand) ** 2))
    ss_err = max(1e-12, ss_total - ss_rows - ss_cols)
    ms_rows = ss_rows / (n - 1)
    ms_cols = ss_cols / max(1, k - 1)
    ms_err = ss_err / max(1, (n - 1) * (k - 1))

    alpha = float(options.get("alpha", 0.05))
    # ICC(2,1) Two-way random, single measures, absolute agreement
    icc21 = (ms_rows - ms_err) / (ms_rows + (k - 1) * ms_err + (k / n) * (ms_cols - ms_err))
    # ICC(3,1) Two-way mixed, single measures, consistency
    icc31 = (ms_rows - ms_err) / (ms_rows + (k - 1) * ms_err)
    # ICC(2,k) / ICC(3,k) Average measures
    icc2k = (ms_rows - ms_err) / (ms_rows + (ms_cols - ms_err) / n)
    icc3k = (ms_rows - ms_err) / ms_rows if ms_rows > 0 else 0.0

    f_val = ms_rows / ms_err
    df1, df2 = n - 1, (n - 1) * (k - 1)
    p_val = float(sp_stats.f.sf(f_val, df1, df2))

    def icc_ci_consistency(icc_v: float) -> tuple[float, float]:
        f_l = f_val / float(sp_stats.f.ppf(1.0 - alpha / 2.0, df1, df2))
        f_u = f_val * float(sp_stats.f.ppf(1.0 - alpha / 2.0, df2, df1))
        lo = (f_l - 1.0) / (f_l + (k - 1))
        hi = (f_u - 1.0) / (f_u + (k - 1))
        _ = icc_v
        return max(-1.0, min(1.0, lo)), max(-1.0, min(1.0, hi))

    # McGraw & Wong (1996) approximate CI for ICC(2,1)
    fj = ms_cols / ms_err
    vn = (k - 1) * (n - 1) * ((k * icc21 * fj + n * (1.0 + (k - 1) * icc21) - k * icc21) ** 2)
    vd = (n - 1) * (k * icc21 * fj) ** 2 + (n * (1.0 + (k - 1) * icc21) - k * icc21) ** 2
    v_df = max(1.0, vn / max(1e-9, vd))
    f_l2 = float(sp_stats.f.ppf(1.0 - alpha / 2.0, n - 1, v_df))
    f_u2 = float(sp_stats.f.ppf(1.0 - alpha / 2.0, v_df, n - 1))
    lo21 = max(-1.0, min(1.0, (n * (ms_rows - f_l2 * ms_err)) / (f_l2 * (k * ms_cols + (k * n - k - n) * ms_err) + n * ms_rows)))
    hi21 = max(-1.0, min(1.0, (n * (f_u2 * ms_rows - ms_err)) / (k * ms_cols + (k * n - k - n) * ms_err + n * f_u2 * ms_rows)))
    lo31, hi31 = icc_ci_consistency(icc31)

    primary = icc21 if icc_type == "agreement" else icc31
    p_lo, p_hi = (lo21, hi21) if icc_type == "agreement" else (lo31, hi31)
    koo_li = "Excelente (>0.90)" if primary > 0.90 else "Buena (0.75–0.90)" if primary >= 0.75 else "Moderada (0.50–0.75)" if primary >= 0.50 else "Pobre (<0.50)"

    charts: list[dict[str, Any]] = []
    if k == 2:
        charts.append({
            "type": "scatter",
            "title": f"Acuerdo entre {vars_list[0]} y {vars_list[1]}",
            "x": "x",
            "series": ["y"],
            "data": [{"x": rn(float(Y[i, 0])), "y": rn(float(Y[i, 1]))} for i in range(min(800, n))],
            "meta": {"slope": 1.0, "intercept": 0.0, "xlabel": vars_list[0], "ylabel": vars_list[1], "xmin": rn(float(np.min(Y[:, 0]))), "xmax": rn(float(np.max(Y[:, 0])))},
        })

    citations = build_library_citations([
        ("numpy", "Descomposición de sumas de cuadrados ANOVA bifactorial para ICC(2,1), ICC(3,1) e ICC promedio"),
        ("scipy", "Distribución F e intervalos de confianza de McGraw & Wong (1996) (scipy.stats.f)"),
    ])
    return {
        "result": {
            "test": "icc",
            "title": f"Coeficiente de correlación intraclase (ICC): {', '.join(vars_list)}",
            "summary": f"{'ICC(2,1) acuerdo absoluto' if icc_type == 'agreement' else 'ICC(3,1) consistencia'} = {rn(primary, 3)} (IC95%: {rn(p_lo, 3)}–{rn(p_hi, 3)}), p = {fp(p_val)} → fiabilidad {koo_li}.",
            "tables": [{
                "title": "Estimaciones ICC (modelo aleatorio/mixto bifactorial)",
                "columns": ["Tipo de ICC", "Estimación", "IC 95%", "F", "gl1 / gl2", "p", "Koo & Li (2016)"],
                "rows": [
                    ["ICC(2,1) Acuerdo absoluto (medida única)", rn(icc21, 3), f"{rn(lo21, 3)} – {rn(hi21, 3)}", rn(f_val, 2), f"{df1}/{df2}", fp(p_val), koo_li if icc_type == "agreement" else "—"],
                    ["ICC(3,1) Consistencia (medida única)", rn(icc31, 3), f"{rn(lo31, 3)} – {rn(hi31, 3)}", rn(f_val, 2), f"{df1}/{df2}", fp(p_val), koo_li if icc_type == "consistency" else "—"],
                    ["ICC(2,k) Acuerdo absoluto (promedio)", rn(icc2k, 3), "—", "—", "—", "—", "—"],
                    ["ICC(3,k) Consistencia (promedio)", rn(icc3k, 3), "—", "—", "—", "—", "—"],
                ],
                "note": f"N = {n} sujetos, k = {k} mediciones/evaluadores. Línea diagonal en gráfico representa identidad perfecta (y = x).",
            }],
            "charts": charts,
        },
        "citations": citations,
        "warnings": [],
    }


# =============================================================================
# 4. Regresión y Predicción (+ Diagnóstico, Calibración y Validación)
# =============================================================================

def run_linreg(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    outcome, predictors = params["outcome"], params["predictors"]
    X, y, term_names = build_design_matrix(rows, outcome, predictors, var_map, binary_outcome=False)
    model = sm.OLS(y, X).fit()
    ci = model.conf_int(alpha=options.get("alpha", 0.05))
    n = int(model.nobs)
    p = len(term_names)
    seed = int(options.get("seed", 42))

    vifs: list[Any] = [None] * p
    if p > 2:
        X_arr = X.to_numpy(dtype=float)
        for idx in range(1, p):
            try:
                vifs[idx] = rn(float(variance_inflation_factor(X_arr, idx)), 2)
            except Exception:
                vifs[idx] = None

    coef_rows = []
    for idx, t in enumerate(term_names):
        coef_rows.append([
            t, rn(float(model.params.iloc[idx]), 4), rn(float(model.bse.iloc[idx]), 4),
            rn(float(model.tvalues.iloc[idx]), 3), fp(float(model.pvalues.iloc[idx])),
            rn(float(ci.iloc[idx, 0]), 4), rn(float(ci.iloc[idx, 1]), 4),
            vifs[idx] if vifs[idx] is not None else "—",
        ])

    # Model Diagnostics
    resid = model.resid.to_numpy(dtype=float)
    fitted = model.fittedvalues.to_numpy(dtype=float)
    y_arr = y.to_numpy(dtype=float)
    sw_p = float(sp_stats.shapiro(resid).pvalue) if 3 <= n <= 5000 and np.std(resid) > 0 else None
    _, bp_p, _, _ = het_breuschpagan(resid, X.to_numpy(dtype=float))
    dw = float(durbin_watson(resid))
    infl = OLSInfluence(model)
    cooks_d, _ = infl.cooks_distance
    max_cook = float(np.max(cooks_d))
    n_high_cook = int((cooks_d > (4.0 / n)).sum())

    # Model Validation (in-sample + k-fold CV)
    rmse = math.sqrt(float(mean_squared_error(y_arr, fitted)))
    mae = float(mean_absolute_error(y_arr, fitted))
    cv_r2_str = "—"
    cv_rmse_str = "—"
    n_splits = min(5, n // max(2, p + 1)) if n >= 10 else 0
    if n_splits >= 2:
        kf = KFold(n_splits=n_splits, shuffle=True, random_state=seed)
        preds_cv = np.zeros(n, dtype=float)
        X_np = X.to_numpy(dtype=float)
        ok_cv = True
        for tr_idx, te_idx in kf.split(X_np):
            try:
                fold_m = sm.OLS(y_arr[tr_idx], X_np[tr_idx]).fit()
                preds_cv[te_idx] = fold_m.predict(X_np[te_idx])
            except Exception:
                ok_cv = False
                break
        if ok_cv:
            ss_res_cv = float(np.sum((y_arr - preds_cv) ** 2))
            ss_tot_cv = float(np.sum((y_arr - np.mean(y_arr)) ** 2))
            cv_r2_str = str(rn(1.0 - ss_res_cv / ss_tot_cv, 3)) if ss_tot_cv > 0 else "—"
            cv_rmse_str = str(rn(math.sqrt(float(mean_squared_error(y_arr, preds_cv))), 3))

    charts: list[dict[str, Any]] = []
    if len(predictors) == 1 and var_map.get(predictors[0], {}).get("type", "numeric") == "numeric":
        xv = X[predictors[0]].to_numpy(dtype=float)
        charts.append({
            "type": "scatter",
            "title": f"{outcome} vs {predictors[0]}",
            "x": "x",
            "series": ["y"],
            "data": [{"x": rn(float(xv[i])), "y": rn(float(y_arr[i]))} for i in range(min(800, n))],
            "meta": {"slope": rn(float(model.params.iloc[1]), 4), "intercept": rn(float(model.params.iloc[0]), 4), "xlabel": predictors[0], "ylabel": outcome, "xmin": rn(float(np.min(xv))), "xmax": rn(float(np.max(xv)))},
        })
    charts.append({
        "type": "scatter",
        "title": "Diagnóstico: Residuos vs Valores predichos",
        "x": "x",
        "series": ["y"],
        "data": [{"x": rn(float(fitted[i]), 3), "y": rn(float(resid[i]), 3)} for i in range(min(800, n))],
        "meta": {"slope": 0.0, "intercept": 0.0, "xlabel": "Predicho (ŷ)", "ylabel": "Residuo", "xmin": rn(float(np.min(fitted)), 3), "xmax": rn(float(np.max(fitted)), 3)},
    })

    warnings = []
    if bp_p < 0.05:
        warnings.append(f"Posible heterocedasticidad (Breusch-Pagan p={fp(float(bp_p))}).")
    if sw_p is not None and sw_p < 0.05:
        warnings.append(f"Residuos no normales (Shapiro-Wilk p={fp(sw_p)}).")

    citations = build_library_citations([
        ("statsmodels", "OLS, FIV, Breusch-Pagan, Durbin-Watson y distancia de Cook (statsmodels)"),
        ("scikit-learn", "RMSE, MAE y validación cruzada K-Fold (scikit-learn)"),
    ])
    return {
        "result": {
            "test": "linreg",
            "title": f"Regresión lineal: {outcome}",
            "summary": f"R² = {rn(float(model.rsquared), 3)} (ajustado {rn(float(model.rsquared_adj), 3)}), F = {rn(float(model.fvalue), 2)}, p = {fp(float(model.f_pvalue))}, RMSE = {rn(rmse, 3)}, N = {n}.",
            "tables": [
                {
                    "title": "Resumen del modelo",
                    "columns": ["N", "R²", "R² ajustado", "F", "p (F)", "AIC", "RMSE", "MAE"],
                    "rows": [[n, rn(float(model.rsquared)), rn(float(model.rsquared_adj)), rn(float(model.fvalue)), fp(float(model.f_pvalue)), rn(float(model.aic), 1), rn(rmse, 3), rn(mae, 3)]],
                    "note": "",
                },
                {
                    "title": "Coeficientes",
                    "columns": ["Término", "B", "EE", "t", "p", "IC95% inf", "IC95% sup", "FIV"],
                    "rows": coef_rows,
                    "note": "FIV > 5 sugiere colinealidad relevante." if p > 2 else "",
                },
                {
                    "title": "Diagnóstico de supuestos y validación cruzada",
                    "columns": ["Shapiro-Wilk residuos (p)", "Breusch-Pagan homocedast. (p)", "Durbin-Watson", "Cook máx.", "Influyentes (D>4/N)", f"CV {n_splits}-fold R²" if n_splits >= 2 else "CV R²", f"CV {n_splits}-fold RMSE" if n_splits >= 2 else "CV RMSE"],
                    "rows": [[fp(sw_p), fp(float(bp_p)), rn(dw, 3), rn(max_cook, 3), n_high_cook, cv_r2_str, cv_rmse_str]],
                    "note": " ".join(warnings) if warnings else "Supuestos residuales y validación cruzada evaluados.",
                },
            ],
            "charts": charts,
        },
        "citations": citations,
        "warnings": warnings,
    }


def run_logreg(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    outcome, predictors = params["outcome"], params["predictors"]
    X, y, term_names = build_design_matrix(rows, outcome, predictors, var_map, binary_outcome=True)
    events = int(y.sum())
    n = int(len(y))
    seed = int(options.get("seed", 42))
    if events == 0 or events == n:
        raise WorkerStatsError("La variable dependiente binaria debe contener ambos valores (0 y 1).")
    try:
        model = sm.Logit(y, X).fit(disp=False, maxiter=100)
    except Exception as exc:
        raise WorkerStatsError(f"El modelo logístico no convergió: {exc}") from exc

    probs = np.clip(model.predict(X).to_numpy(dtype=float), 1e-12, 1.0 - 1e-12)
    y_arr = y.to_numpy(dtype=int)
    auc_val = float(roc_auc_score(y_arr, probs))
    brier = float(brier_score_loss(y_arr, probs))

    # Nagelkerke R2
    r2_cs = 1.0 - math.exp((2.0 / n) * (float(model.llnull) - float(model.llf)))
    max_cs = 1.0 - math.exp((2.0 / n) * float(model.llnull))
    nagelkerke = r2_cs / max_cs if max_cs > 0 else 0.0

    # Calibration intercept & slope via logistic recalibration logit(y) ~ a + b*logit(p)
    lp = np.log(probs / (1.0 - probs))
    try:
        cal_fit = sm.Logit(y_arr, sm.add_constant(lp)).fit(disp=False, maxiter=50)
        cal_int = float(cal_fit.params.iloc[0])
        cal_slope = float(cal_fit.params.iloc[1])
    except Exception:
        cal_int, cal_slope = 0.0, 1.0

    # Hosmer-Lemeshow (up to 10 quantile bins)
    n_bins = max(3, min(10, n // 5))
    hl_chi, hl_p = 0.0, 1.0
    try:
        bins = pd.qcut(probs, q=n_bins, duplicates="drop")
        hl_df = pd.DataFrame({"y": y_arr, "p": probs, "bin": bins}).groupby("bin", observed=True)
        g_cnt = 0
        for _, grp in hl_df:
            ng = len(grp)
            o1 = float(grp["y"].sum())
            e1 = float(grp["p"].sum())
            if 0.0 < e1 < ng:
                hl_chi += ((o1 - e1) ** 2) / (e1 * (1.0 - e1 / ng))
                g_cnt += 1
        hl_p = float(sp_stats.chi2.sf(hl_chi, max(1, g_cnt - 2))) if g_cnt > 2 else 1.0
    except Exception:
        pass

    prob_true, prob_pred = calibration_curve(y_arr, probs, n_bins=min(8, max(3, n // 6)), strategy="quantile")
    cal_chart_data = [{"predicho": rn(float(pp), 3), "Observado": rn(float(pt), 3), "Referencia ideal": rn(float(pp), 3)} for pt, pp in zip(prob_true, prob_pred)]

    # 5-fold Stratified Cross-Validation
    cv_auc_str, cv_brier_str = "—", "—"
    min_cls = min(events, n - events)
    k_folds = min(5, min_cls)
    if k_folds >= 2 and n >= 12:
        skf = StratifiedKFold(n_splits=k_folds, shuffle=True, random_state=seed)
        oof = np.zeros(n, dtype=float)
        X_np = X.to_numpy(dtype=float)
        ok_cv = True
        for tr_i, te_i in skf.split(X_np, y_arr):
            try:
                fm = sm.Logit(y_arr[tr_i], X_np[tr_i]).fit(disp=False, maxiter=80)
                oof[te_i] = fm.predict(X_np[te_i])
            except Exception:
                ok_cv = False
                break
        if ok_cv:
            cv_auc_str = str(rn(float(roc_auc_score(y_arr, oof)), 3))
            cv_brier_str = str(rn(float(brier_score_loss(y_arr, oof)), 4))

    ci = model.conf_int(alpha=options.get("alpha", 0.05))
    coef_rows = []
    or_chart = []
    for idx, t in enumerate(term_names):
        b = float(model.params.iloc[idx])
        se = float(model.bse.iloc[idx])
        z = float(model.tvalues.iloc[idx])
        pv = float(model.pvalues.iloc[idx])
        or_val = math.exp(min(20.0, max(-20.0, b)))
        lo = math.exp(min(20.0, max(-20.0, float(ci.iloc[idx, 0]))))
        hi = math.exp(min(20.0, max(-20.0, float(ci.iloc[idx, 1]))))
        coef_rows.append([t, rn(b, 4), rn(se, 4), rn(z, 3), fp(pv), rn(or_val), f"{rn(lo)} – {rn(hi)}"])
        if t != "Constante":
            or_chart.append({"category": t, "OR": rn(or_val), "lo": rn(lo), "hi": rn(hi)})

    citations = build_library_citations([
        ("statsmodels", "Regresión logística binaria por máxima verosimilitud (statsmodels.api.Logit)"),
        ("scikit-learn", "AUC, Brier score, curva de calibración y validación cruzada estratificada (scikit-learn)"),
    ])
    return {
        "result": {
            "test": "logreg",
            "title": f"Regresión logística: {outcome}",
            "summary": f"Pseudo R² = {rn(float(model.prsquared), 3)}, AUC = {rn(auc_val, 3)}, Brier = {rn(brier, 4)}, Hosmer-Lemeshow p = {fp(hl_p)}, N = {n}.",
            "tables": [
                {
                    "title": "Resumen del modelo",
                    "columns": ["N", "Eventos", "McFadden R²", "Nagelkerke R²", "AUC (C-index)", "AIC", "p (LR)"],
                    "rows": [[n, events, rn(float(model.prsquared), 3), rn(nagelkerke, 3), rn(auc_val, 3), rn(float(model.aic), 1), fp(float(model.llr_pvalue))]],
                    "note": "",
                },
                {
                    "title": "Coeficientes (Odds Ratios)",
                    "columns": ["Término", "B", "EE", "z", "p", "OR", "IC95% OR"],
                    "rows": coef_rows,
                    "note": "",
                },
                {
                    "title": "Calibración, bondad de ajuste y validación cruzada",
                    "columns": ["Hosmer-Lemeshow χ²", "p (HL)", "Brier score", "Intercepto cal.", "Pendiente cal.", f"CV {k_folds}-fold AUC" if k_folds >= 2 else "CV AUC", "CV Brier"],
                    "rows": [[rn(hl_chi, 2), fp(hl_p), rn(brier, 4), rn(cal_int, 3), rn(cal_slope, 3), cv_auc_str, cv_brier_str]],
                    "note": "Hosmer-Lemeshow p ≥ 0.05, Brier cercano a 0 y pendiente cercana a 1 indican buena calibración.",
                },
            ],
            "charts": [
                {"type": "bar", "title": "Odds Ratios ajustados", "x": "category", "series": ["OR"], "data": or_chart, "meta": {"refline": 1}},
                *([{"type": "line", "title": "Curva de calibración (probabilidad predicha vs observada)", "x": "predicho", "series": ["Observado", "Referencia ideal"], "data": cal_chart_data, "meta": {}}] if cal_chart_data else []),
            ],
        },
        "citations": citations,
        "warnings": ["Posible desajuste de calibración (Hosmer-Lemeshow p < 0.05)."] if hl_p < 0.05 else [],
    }


def run_poisson_reg(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    outcome, predictors = params["outcome"], params["predictors"]
    X, y, term_names = build_design_matrix(rows, outcome, predictors, var_map, binary_outcome=False)
    if (y < 0).any():
        raise WorkerStatsError(f"La variable de conteo '{outcome}' no puede tener valores negativos en regresión de Poisson.")
    n = int(len(y))
    model = sm.GLM(y, X, family=sm.families.Poisson()).fit()
    null_model = sm.GLM(y, X[["Constante"]], family=sm.families.Poisson()).fit()
    lr_stat = max(0.0, 2.0 * (float(model.llf) - float(null_model.llf)))
    lr_p = float(sp_stats.chi2.sf(lr_stat, max(1, len(term_names) - 1)))
    pseudo_r2 = 1.0 - float(model.llf) / float(null_model.llf) if float(null_model.llf) != 0 else 0.0
    ci = model.conf_int(alpha=options.get("alpha", 0.05))
    coef_rows, irr_chart = [], []
    for idx, t in enumerate(term_names):
        b, se, z, pv = float(model.params.iloc[idx]), float(model.bse.iloc[idx]), float(model.tvalues.iloc[idx]), float(model.pvalues.iloc[idx])
        irr = math.exp(min(20.0, max(-20.0, b)))
        lo = math.exp(min(20.0, max(-20.0, float(ci.iloc[idx, 0]))))
        hi = math.exp(min(20.0, max(-20.0, float(ci.iloc[idx, 1]))))
        coef_rows.append([t, rn(b, 4), rn(se, 4), rn(z, 3), fp(pv), rn(irr, 3), f"{rn(lo, 3)} – {rn(hi, 3)}"])
        if t != "Constante":
            irr_chart.append({"category": t, "IRR": rn(irr, 3)})

    dispersion = float(model.pearson_chi2 / max(1, model.df_resid))
    warnings = []
    if dispersion > 1.5:
        warnings.append(f"⚠ Sobredispersión detectada (χ² Pearson/gl = {rn(dispersion, 2)} > 1.5): considera Regresión Binomial Negativa.")

    citations = build_library_citations([
        ("statsmodels", "GLM de Poisson con enlace logarítmico (statsmodels.api.GLM)"),
        ("scipy", "Prueba χ² de razón de verosimilitud (scipy.stats.chi2)"),
    ])
    return {
        "result": {
            "test": "poisson_reg",
            "title": f"Regresión de Poisson (tasas e incidencia): {outcome}",
            "summary": f"Pseudo R² = {rn(pseudo_r2, 3)}, Dispersión = {rn(dispersion, 2)}, AIC = {rn(float(model.aic), 1)}, p (LR) = {fp(lr_p)}, N = {n}.",
            "tables": [
                {"title": "Resumen del modelo", "columns": ["N", "Devianza", "Dispersión (χ²/gl)", "Pseudo R²", "AIC", "p (LR)"], "rows": [[n, rn(float(model.deviance), 2), rn(dispersion, 2), rn(pseudo_r2, 3), rn(float(model.aic), 1), fp(lr_p)]], "note": " ".join(warnings)},
                {"title": "Coeficientes (Razones de Tasas de Incidencia · IRR)", "columns": ["Término", "β", "EE", "z", "p", "IRR", "IC 95% IRR"], "rows": coef_rows, "note": "IRR > 1 indica aumento proporcional en la tasa/conteo esperado."},
            ],
            "charts": [{"type": "bar", "title": "Razones de Tasas de Incidencia (IRR)", "x": "category", "series": ["IRR"], "data": irr_chart, "meta": {"refline": 1}}],
        },
        "citations": citations,
        "warnings": warnings,
    }


def run_negbin_reg(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    outcome, predictors = params["outcome"], params["predictors"]
    X, y, term_names = build_design_matrix(rows, outcome, predictors, var_map, binary_outcome=False)
    if (y < 0).any():
        raise WorkerStatsError(f"La variable de conteo '{outcome}' no puede tener valores negativos.")
    n = int(len(y))
    try:
        nb_mod = sm.NegativeBinomial(y, X).fit(disp=False, maxiter=200)
        alpha_disp = float(nb_mod.params.iloc[-1])
        coef_count = len(term_names)
        llf_nb = float(nb_mod.llf)
        aic_nb = float(nb_mod.aic)
        ci = nb_mod.conf_int(alpha=options.get("alpha", 0.05))
        params_s = nb_mod.params.iloc[:coef_count]
        bse_s = nb_mod.bse.iloc[:coef_count]
        t_s = nb_mod.tvalues.iloc[:coef_count]
        p_s = nb_mod.pvalues.iloc[:coef_count]
    except Exception:
        pois = sm.GLM(y, X, family=sm.families.Poisson()).fit()
        alpha_disp = max(0.05, float((pois.pearson_chi2 / max(1, pois.df_resid) - 1.0) / max(1.0, float(np.mean(y)))))
        nb_mod = sm.GLM(y, X, family=sm.families.NegativeBinomial(alpha=alpha_disp)).fit()
        coef_count = len(term_names)
        llf_nb = float(nb_mod.llf)
        aic_nb = float(nb_mod.aic)
        ci = nb_mod.conf_int(alpha=options.get("alpha", 0.05))
        params_s, bse_s, t_s, p_s = nb_mod.params, nb_mod.bse, nb_mod.tvalues, nb_mod.pvalues

    pois_ref = sm.GLM(y, X, family=sm.families.Poisson()).fit()
    lr_overdisp = max(0.0, 2.0 * (llf_nb - float(pois_ref.llf)))
    p_overdisp = float(0.5 * sp_stats.chi2.sf(lr_overdisp, 1)) if lr_overdisp > 0 else 1.0

    coef_rows, irr_chart = [], []
    for idx, t in enumerate(term_names):
        b, se, z, pv = float(params_s.iloc[idx]), float(bse_s.iloc[idx]), float(t_s.iloc[idx]), float(p_s.iloc[idx])
        irr = math.exp(min(20.0, max(-20.0, b)))
        lo = math.exp(min(20.0, max(-20.0, float(ci.iloc[idx, 0]))))
        hi = math.exp(min(20.0, max(-20.0, float(ci.iloc[idx, 1]))))
        coef_rows.append([t, rn(b, 4), rn(se, 4), rn(z, 3), fp(pv), rn(irr, 3), f"{rn(lo, 3)} – {rn(hi, 3)}"])
        if t != "Constante":
            irr_chart.append({"category": t, "IRR": rn(irr, 3)})

    citations = build_library_citations([
        ("statsmodels", "Regresión Binomial Negativa (statsmodels.api.NegativeBinomial)"),
        ("scipy", "Prueba de razón de verosimilitud frente a Poisson para sobredispersión (scipy.stats.chi2)"),
    ])
    return {
        "result": {
            "test": "negbin_reg",
            "title": f"Regresión Binomial Negativa (conteos sobredispersos): {outcome}",
            "summary": f"α dispersión = {rn(alpha_disp, 3)}, AIC = {rn(aic_nb, 1)} (vs Poisson AIC = {rn(float(pois_ref.aic), 1)}), p sobredispersión = {fp(p_overdisp)}, N = {n}.",
            "tables": [
                {
                    "title": "Ajuste y comparación frente a Poisson",
                    "columns": ["N", "Log-Verosimilitud", "AIC (Bin. Neg.)", "AIC (Poisson)", "Dispersión α", "LR vs Poisson", "p (α > 0)"],
                    "rows": [[n, rn(llf_nb, 2), rn(aic_nb, 1), rn(float(pois_ref.aic), 1), rn(alpha_disp, 4), rn(lr_overdisp, 2), fp(p_overdisp)]],
                    "note": "p (α > 0) < 0.05 confirma sobredispersión y respalda Binomial Negativa frente a Poisson.",
                },
                {
                    "title": "Coeficientes (Razones de Tasas de Incidencia · IRR)",
                    "columns": ["Término", "β", "EE", "z", "p", "IRR", "IC 95% IRR"],
                    "rows": coef_rows,
                    "note": "",
                },
            ],
            "charts": [{"type": "bar", "title": "Razones de Tasas de Incidencia (Binomial Negativa)", "x": "category", "series": ["IRR"], "data": irr_chart, "meta": {"refline": 1}}],
        },
        "citations": citations,
        "warnings": [],
    }


# =============================================================================
# 5. Epidemiología Clínica
# =============================================================================

def run_epidemiology_2x2(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    exp_col, out_col = params["exposure"], params["outcome"]
    e_s, e_pos, e_neg = resolve_binary_series(rows, exp_col)
    o_s, o_pos, o_neg = resolve_binary_series(rows, out_col)
    valid = [(e, o) for e, o in zip(e_s, o_s) if e is not None and o is not None]
    if not valid:
        raise WorkerStatsError("No hay pares binarios válidos para análisis epidemiológico 2×2.")
    a = sum(1 for e, o in valid if e == 1 and o == 1)
    b = sum(1 for e, o in valid if e == 1 and o == 0)
    c = sum(1 for e, o in valid if e == 0 and o == 1)
    d = sum(1 for e, o in valid if e == 0 and o == 0)
    n1, n0 = a + b, c + d
    if n1 == 0 or n0 == 0:
        raise WorkerStatsError("Ambos niveles de exposición deben tener observaciones.")
    ie, i0 = a / n1, c / n0
    rr = ie / i0 if i0 > 0 else float("inf")
    se_ln_rr = math.sqrt((1 / a - 1 / n1) + (1 / c - 1 / n0)) if a > 0 and c > 0 else 0.0
    rr_lo, rr_hi = (math.exp(math.log(rr) - 1.96 * se_ln_rr), math.exp(math.log(rr) + 1.96 * se_ln_rr)) if math.isfinite(rr) and rr > 0 else (0.0, 0.0)
    or_val = (a * d) / (b * c) if b > 0 and c > 0 else float("inf")
    se_ln_or = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) if min(a, b, c, d) > 0 else 0.0
    or_lo, or_hi = (math.exp(math.log(or_val) - 1.96 * se_ln_or), math.exp(math.log(or_val) + 1.96 * se_ln_or)) if math.isfinite(or_val) and or_val > 0 else (0.0, 0.0)

    arr = i0 - ie
    se_arr = math.sqrt((ie * (1 - ie)) / n1 + (i0 * (1 - i0)) / n0)
    arr_lo, arr_hi = arr - 1.96 * se_arr, arr + 1.96 * se_arr
    rrr = (1.0 - rr) * 100.0 if math.isfinite(rr) else 0.0
    rrr_lo = (1.0 - rr_hi) * 100.0 if rr_hi > 0 else 0.0
    rrr_hi = (1.0 - rr_lo) * 100.0 if rr_lo > 0 else 0.0
    nnt = math.ceil(1.0 / abs(arr)) if abs(arr) > 1e-6 else None
    nnt_lbl = "NNT (a tratar)" if arr >= 0 else "NNH (a dañar)"
    _, fisher_p = sp_stats.fisher_exact([[a, b], [c, d]])
    chi2_v, chi_p, _, _ = sp_stats.chi2_contingency([[a, b], [c, d]], correction=False)

    citations = build_library_citations([
        ("scipy", "Prueba exacta de Fisher y χ² 2×2 (scipy.stats.fisher_exact, chi2_contingency)"),
    ])
    return {
        "result": {
            "test": "epidemiology_2x2",
            "title": f"Epidemiología 2×2: {exp_col} → {out_col}",
            "summary": f"RR = {rn(rr, 2)} (IC95% {rn(rr_lo, 2)}–{rn(rr_hi, 2)}), OR = {rn(or_val, 2)}, RAR = {rn(abs(arr) * 100, 1)}%, RRR = {rn(rrr, 1)}%, {nnt_lbl} = {nnt or '∞'}, p Fisher = {fp(float(fisher_p))}.",
            "tables": [
                {
                    "title": "Tabla de incidencia 2×2",
                    "columns": [exp_col, f"{out_col}={o_pos}", f"{out_col}={o_neg}", "Total", "Incidencia (%)"],
                    "rows": [
                        [f"Expuesto ({e_pos})", a, b, n1, f"{rn(ie * 100, 1)}%"],
                        [f"No expuesto ({e_neg})", c, d, n0, f"{rn(i0 * 100, 1)}%"],
                        ["Total", a + c, b + d, n1 + n0, f"{rn(100.0 * (a + c) / (n1 + n0), 1)}%"],
                    ],
                    "note": f"χ²(1) = {rn(chi2_v, 2)}, p(χ²) = {fp(float(chi_p))}, p(Fisher) = {fp(float(fisher_p))}.",
                },
                {
                    "title": "Medidas de asociación e impacto clínico (IC 95%)",
                    "columns": ["Medida", "Estimación", "IC 95%"],
                    "rows": [
                        ["Riesgo Relativo (RR)", rn(rr, 3) if math.isfinite(rr) else "∞", f"{rn(rr_lo, 3)} – {rn(rr_hi, 3)}"],
                        ["Odds Ratio (OR)", rn(or_val, 3) if math.isfinite(or_val) else "∞", f"{rn(or_lo, 3)} – {rn(or_hi, 3)}"],
                        ["Reducción Absoluta del Riesgo (RAR / ARR)" if arr >= 0 else "Aumento Absoluto del Riesgo (RAE)", f"{rn(abs(arr) * 100, 2)}%", f"{rn(arr_lo * 100, 2)}% – {rn(arr_hi * 100, 2)}%"],
                        ["Reducción Relativa del Riesgo (RRR)", f"{rn(rrr, 1)}%", f"{rn(rrr_lo, 1)}% – {rn(rrr_hi, 1)}%"],
                        [nnt_lbl, nnt if nnt is not None else "∞ (sin diferencia)", "—"],
                    ],
                    "note": "IC 95%: Katz (RR / RRR), Woolf (OR) y Wald (RAR).",
                },
            ],
            "charts": [{
                "type": "bar",
                "title": f"Incidencia de {out_col} (%)",
                "x": "grupo",
                "series": ["Incidencia (%)"],
                "data": [{"grupo": f"{exp_col}: {e_pos}", "Incidencia (%)": rn(ie * 100, 1)}, {"grupo": f"{exp_col}: {e_neg}", "Incidencia (%)": rn(i0 * 100, 1)}],
                "meta": {},
            }],
        },
        "citations": citations,
        "warnings": [],
    }


def run_incidence_prevalence(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    out_col = params["outcome"]
    grp_col = params.get("group") or ""
    time_col = params.get("time") or ""
    o_vals, o_pos, _ = resolve_binary_series(rows, out_col)

    recs = []
    for i, r in enumerate(rows):
        ov = o_vals[i]
        if ov is None:
            continue
        gv = to_lbl(r.get(grp_col)) if grp_col else "Cohorte global"
        if grp_col and gv is None:
            continue
        tv = to_num(r.get(time_col)) if time_col else None
        if time_col and (tv is None or tv < 0):
            continue
        recs.append({"o": ov, "g": str(gv), "t": tv})

    if not recs:
        raise WorkerStatsError("No hay registros válidos para calcular incidencia/prevalencia.")

    def poisson_byar_ci(cases: int, pt: float) -> tuple[float, float]:
        if pt <= 0:
            return (0.0, 0.0)
        if cases == 0:
            return (0.0, 3.6889 / pt)
        z = 1.96
        lo = cases * ((1.0 - 1.0 / (9.0 * cases) - z / (3.0 * math.sqrt(cases))) ** 3) / pt
        hi = (cases + 1.0) * ((1.0 - 1.0 / (9.0 * (cases + 1.0)) + z / (3.0 * math.sqrt(cases + 1.0))) ** 3) / pt
        return (max(0.0, lo), hi)

    groups = list(dict.fromkeys([r["g"] for r in recs]))
    if len(groups) > 1:
        groups = ["Cohorte global", *groups]

    prev_rows: list[list[Any]] = []
    rate_rows: list[list[Any]] = []
    chart_data: list[dict[str, Any]] = []

    for gname in groups:
        sub = recs if gname == "Cohorte global" else [r for r in recs if r["g"] == gname]
        n_sub = len(sub)
        k_sub = sum(r["o"] for r in sub)
        p_hat = k_sub / max(1, n_sub)
        lo, hi = proportion_confint(k_sub, n_sub, alpha=0.05, method="wilson")
        prev_rows.append([gname, n_sub, k_sub, f"{rn(p_hat * 100, 2)}%", f"{rn(float(lo) * 100, 2)}% – {rn(float(hi) * 100, 2)}%", rn(p_hat * 1000, 1)])
        if gname != "Cohorte global" or len(groups) == 1:
            chart_data.append({"grupo": gname, "Prevalencia / Incidencia (%)": rn(p_hat * 100, 2)})
        if time_col:
            pt = sum(float(r["t"]) for r in sub if r["t"] is not None)
            ir = (k_sub / pt) if pt > 0 else 0.0
            r_lo, r_hi = poisson_byar_ci(k_sub, pt)
            rate_rows.append([gname, k_sub, rn(pt, 1), rn(ir * 1000, 2), f"{rn(r_lo * 1000, 2)} – {rn(r_hi * 1000, 2)}"])

    tables = [{
        "title": f"Prevalencia puntual / Incidencia acumulada de {out_col} ({o_pos})",
        "columns": ["Grupo", "N en riesgo", "Casos", "Prevalencia / Incidencia %", "IC 95% (Wilson)", "Por 1,000 sujetos"],
        "rows": prev_rows,
        "note": "Intervalos de confianza del 95% de Wilson.",
    }]
    if time_col and rate_rows:
        tables.append({
            "title": f"Densidad de incidencia (tasa por {time_col})",
            "columns": ["Grupo", "Eventos", "Personas-tiempo", "Tasa / 1,000 p-t", "IC 95% Byar (/1,000 p-t)"],
            "rows": rate_rows,
            "note": "Intervalo de confianza de Poisson exacto/aproximación de Byar.",
        })

    tot_k = sum(r["o"] for r in recs)
    tot_n = len(recs)
    citations = build_library_citations([
        ("statsmodels", "Intervalos de confianza binomiales de Wilson (statsmodels.stats.proportion.proportion_confint)"),
    ])
    return {
        "result": {
            "test": "incidence_prevalence",
            "title": f"Incidencia y prevalencia: {out_col}",
            "summary": f"{tot_k}/{tot_n} casos ({rn(100.0 * tot_k / tot_n, 2)}%; {rn(1000.0 * tot_k / tot_n, 1)} por 1,000).",
            "tables": tables,
            "charts": [{"type": "bar", "title": "Prevalencia / Incidencia (%)", "x": "grupo", "series": ["Prevalencia / Incidencia (%)"], "data": chart_data, "meta": {}}],
        },
        "citations": citations,
        "warnings": [],
    }


def run_diagnostic_test(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    tv, gs = params["test_var"], params["gold_standard"]
    t_s, t_pos, t_neg = resolve_binary_series(rows, tv)
    g_s, g_pos, g_neg = resolve_binary_series(rows, gs)
    valid = [(a, b) for a, b in zip(t_s, g_s) if a is not None and b is not None]
    if not valid:
        raise WorkerStatsError("No hay pares binarios válidos para evaluación diagnóstica.")
    tp = sum(1 for t, g in valid if t == 1 and g == 1)
    fp_c = sum(1 for t, g in valid if t == 1 and g == 0)
    fn = sum(1 for t, g in valid if t == 0 and g == 1)
    tn = sum(1 for t, g in valid if t == 0 and g == 0)
    if (tp + fn) == 0 or (fp_c + tn) == 0:
        raise WorkerStatsError("El estándar de oro necesita casos positivos y negativos.")

    def prop_ci(k: int, n_tot: int) -> tuple[float, float, float]:
        if n_tot == 0:
            return (0.0, 0.0, 0.0)
        lo, hi = proportion_confint(k, n_tot, alpha=0.05, method="wilson")
        return (k / n_tot, float(lo), float(hi))

    sens, s_lo, s_hi = prop_ci(tp, tp + fn)
    spec, sp_lo, sp_hi = prop_ci(tn, tn + fp_c)
    ppv, p_lo, p_hi = prop_ci(tp, tp + fp_c)
    npv, n_lo, n_hi = prop_ci(tn, tn + fn)
    acc, a_lo, a_hi = prop_ci(tp + tn, len(valid))
    prev = (tp + fn) / len(valid)

    lr_pos = sens / (1.0 - spec) if spec < 1.0 else float("inf")
    lr_neg = (1.0 - sens) / spec if spec > 0.0 else float("inf")
    # Simel (1991) 95% CI for LR+ and LR-
    lrp_ci = "—"
    if tp > 0 and fp_c > 0 and math.isfinite(lr_pos):
        se_lrp = math.sqrt((1 - sens) / tp + spec / fp_c)
        lrp_ci = f"{rn(lr_pos * math.exp(-1.96 * se_lrp), 2)} – {rn(lr_pos * math.exp(1.96 * se_lrp), 2)}"
    lrn_ci = "—"
    if fn > 0 and tn > 0 and lr_neg > 0 and math.isfinite(lr_neg):
        se_lrn = math.sqrt(sens / fn + (1 - spec) / tn)
        lrn_ci = f"{rn(lr_neg * math.exp(-1.96 * se_lrn), 3)} – {rn(lr_neg * math.exp(1.96 * se_lrn), 3)}"
    youden = sens + spec - 1.0
    dor = (tp * tn) / (fp_c * fn) if fp_c > 0 and fn > 0 else float("inf")

    citations = build_library_citations([
        ("statsmodels", "IC de Wilson para proporciones diagnósticas y razones de verosimilitud (statsmodels.stats.proportion)"),
    ])
    return {
        "result": {
            "test": "diagnostic_test",
            "title": f"Validez diagnóstica: {tv} vs {gs}",
            "summary": f"Sensibilidad = {rn(sens * 100, 1)}%, Especificidad = {rn(spec * 100, 1)}%, VPP = {rn(ppv * 100, 1)}%, VPN = {rn(npv * 100, 1)}%, LR+ = {rn(lr_pos, 2) if math.isfinite(lr_pos) else '∞'}, LR− = {rn(lr_neg, 3) if math.isfinite(lr_neg) else '∞'}.",
            "tables": [
                {
                    "title": "Tabla de contingencia diagnóstica",
                    "columns": [tv, f"{gs} ({g_pos})", f"{gs} ({g_neg})", "Total"],
                    "rows": [[f"Prueba + ({t_pos})", tp, fp_c, tp + fp_c], [f"Prueba − ({t_neg})", fn, tn, fn + tn], ["Total", tp + fn, fp_c + tn, len(valid)]],
                    "note": f"Prevalencia muestral: {rn(prev * 100, 1)}% ({tp + fn}/{len(valid)}).",
                },
                {
                    "title": "Rendimiento diagnóstico y Likelihood Ratios (IC 95% Wilson / Simel)",
                    "columns": ["Métrica", "Estimación", "IC 95%"],
                    "rows": [
                        ["Sensibilidad", f"{rn(sens * 100, 1)}%", f"{rn(s_lo * 100, 1)}% – {rn(s_hi * 100, 1)}%"],
                        ["Especificidad", f"{rn(spec * 100, 1)}%", f"{rn(sp_lo * 100, 1)}% – {rn(sp_hi * 100, 1)}%"],
                        ["Valor Predictivo Positivo (VPP)", f"{rn(ppv * 100, 1)}%", f"{rn(p_lo * 100, 1)}% – {rn(p_hi * 100, 1)}%"],
                        ["Valor Predictivo Negativo (VPN)", f"{rn(npv * 100, 1)}%", f"{rn(n_lo * 100, 1)}% – {rn(n_hi * 100, 1)}%"],
                        ["Exactitud global", f"{rn(acc * 100, 1)}%", f"{rn(a_lo * 100, 1)}% – {rn(a_hi * 100, 1)}%"],
                        ["Razón de verosimilitud positiva (LR+)", rn(lr_pos, 2) if math.isfinite(lr_pos) else "∞", lrp_ci],
                        ["Razón de verosimilitud negativa (LR−)", rn(lr_neg, 3) if math.isfinite(lr_neg) else "∞", lrn_ci],
                        ["Odds Ratio diagnóstica (DOR)", rn(dor, 2) if math.isfinite(dor) else "∞", "—"],
                        ["Índice de Youden (J)", rn(youden, 3), "—"],
                    ],
                    "note": "LR+ > 10 confirma fuertemente; LR− < 0.1 descarta fuertemente.",
                },
            ],
            "charts": [{
                "type": "bar",
                "title": "Métricas diagnósticas (%)",
                "x": "metrica",
                "series": ["Porcentaje"],
                "data": [
                    {"metrica": "Sensibilidad", "Porcentaje": rn(sens * 100, 1)},
                    {"metrica": "Especificidad", "Porcentaje": rn(spec * 100, 1)},
                    {"metrica": "VPP", "Porcentaje": rn(ppv * 100, 1)},
                    {"metrica": "VPN", "Porcentaje": rn(npv * 100, 1)},
                    {"metrica": "Exactitud", "Porcentaje": rn(acc * 100, 1)},
                ],
                "meta": {},
            }],
        },
        "citations": citations,
        "warnings": [],
    }


def run_roc_auc(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    marker, outcome = params["marker"], params["outcome"]
    m_series = extract_aligned_series(rows, marker, var_map)
    o_series, _, _ = resolve_binary_series(rows, outcome)
    pairs = [(sc, ev) for sc, ev in zip(m_series, o_series) if sc is not None and ev is not None]
    y_arr = np.asarray([p[1] for p in pairs], dtype=int)
    s_arr = np.asarray([p[0] for p in pairs], dtype=float)
    n_pos = int((y_arr == 1).sum())
    n_neg = int((y_arr == 0).sum())
    if n_pos < 2 or n_neg < 2:
        raise WorkerStatsError("Se requieren al menos 2 casos positivos y 2 negativos para la curva ROC.")

    auc = float(roc_auc_score(y_arr, s_arr))
    fpr, tpr, thresholds = roc_curve(y_arr, s_arr)
    youden = tpr - fpr
    best_idx = int(np.argmax(youden))
    best_cut = float(thresholds[best_idx])
    best_sens = float(tpr[best_idx])
    best_spec = float(1.0 - fpr[best_idx])

    q1 = auc / (2.0 - auc)
    q2 = (2.0 * auc * auc) / (1.0 + auc)
    se_auc = math.sqrt((auc * (1.0 - auc) + (n_pos - 1) * (q1 - auc * auc) + (n_neg - 1) * (q2 - auc * auc)) / (n_pos * n_neg))
    ci_lo, ci_hi = max(0.0, auc - 1.96 * se_auc), min(1.0, auc + 1.96 * se_auc)
    z_val = (auc - 0.5) / se_auc if se_auc > 0 else 0.0
    p_val = float(2.0 * sp_stats.norm.sf(abs(z_val)))

    roc_pts = [
        {"fpr": rn(float(fpr[i]), 4), "tpr": rn(float(tpr[i]), 4), "cutoff": rn(float(thresholds[i]), 3) if math.isfinite(float(thresholds[i])) else "∞"}
        for i in range(len(fpr))
    ]
    citations = build_library_citations([
        ("scikit-learn", "Curva ROC y AUC empírico (sklearn.metrics.roc_curve, roc_auc_score)"),
        ("scipy", "Error estándar de Hanley-McNeil y contraste z (scipy.stats.norm)"),
    ])
    return {
        "result": {
            "test": "roc_auc",
            "title": f"Curva ROC y AUC: {marker} → {outcome}",
            "summary": f"AUC = {rn(auc, 3)} (IC95%: {rn(ci_lo, 3)}–{rn(ci_hi, 3)}), p = {fp(p_val)}; corte óptimo Youden = {rn(best_cut, 3)} (Sens {rn(best_sens * 100, 1)}%, Esp {rn(best_spec * 100, 1)}%).",
            "tables": [{
                "title": "Rendimiento discriminativo global",
                "columns": ["N total", "Positivos", "Negativos", "AUC", "EE", "IC 95% AUC", "p (vs 0.5)", "Corte Youden", "Sensibilidad", "Especificidad"],
                "rows": [[int(y_arr.size), n_pos, n_neg, rn(auc, 3), rn(se_auc, 3), f"{rn(ci_lo, 3)} – {rn(ci_hi, 3)}", fp(p_val), rn(best_cut, 3), f"{rn(best_sens * 100, 1)}%", f"{rn(best_spec * 100, 1)}%"]],
                "note": "Error estándar e IC 95% según Hanley & McNeil (1982).",
            }],
            "charts": [{"type": "roc", "title": f"Curva ROC: {marker}", "x": "fpr", "series": ["tpr"], "data": roc_pts, "meta": {"auc": rn(auc, 3)}}],
        },
        "citations": citations,
        "warnings": [],
    }


# =============================================================================
# 6. Supervivencia (+ Diagnóstico de Riesgos Proporcionales)
# =============================================================================

def run_kaplan_meier(rows: list[dict[str, Any]], params: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    tv, ev = params["time"], params["event"]
    gv = params.get("group") or ""
    recs = []
    for r in rows:
        t_val = to_num(r.get(tv))
        e_val = to_event01(r.get(ev))
        if t_val is None or e_val is None or t_val < 0:
            continue
        g_val = to_lbl(r.get(gv)) if gv else "Todos"
        if gv and g_val is None:
            continue
        recs.append({"t": t_val, "e": e_val, "g": str(g_val)})
    if len(recs) < 3:
        raise WorkerStatsError("Observaciones insuficientes para estimación de Kaplan-Meier.")
    df = pd.DataFrame(recs)
    groups = list(dict.fromkeys(df["g"].tolist()))
    alpha = options.get("alpha", 0.05)

    summary_rows, series_curves, all_times = [], {}, {0.0}
    for g in groups:
        sub = df[df["g"] == g]
        kmf = KaplanMeierFitter(alpha=alpha)
        kmf.fit(sub["t"], event_observed=sub["e"], label=g)
        med = kmf.median_survival_time_
        med_str = rn(float(med), 2) if math.isfinite(float(med)) else "No alcanzada"
        merged = pd.concat([kmf.survival_function_, kmf.confidence_interval_survival_function_], axis=1)
        merged.columns = ["surv", "ci_lo", "ci_hi"]
        series_curves[g] = merged
        all_times.update([float(x) for x in merged.index.tolist()])
        summary_rows.append([g, int(len(sub)), int(sub["e"].sum()), med_str, rn(float(merged["surv"].iloc[-1]), 3)])

    chart_data = []
    for t in sorted(all_times):
        pt: dict[str, Any] = {"t": rn(t, 3)}
        for g in groups:
            curve = series_curves[g]
            idx_pos = max(0, min(len(curve) - 1, int(curve.index.searchsorted(t, side="right") - 1)))
            row_val = curve.iloc[idx_pos]
            pt[g] = rn(float(row_val["surv"]), 4)
            pt[f"{g}__ci_lo"] = rn(max(0.0, min(1.0, float(row_val["ci_lo"]))), 4)
            pt[f"{g}__ci_hi"] = rn(max(0.0, min(1.0, float(row_val["ci_hi"]))), 4)
        chart_data.append(pt)

    lr_note, lr_p_str = "", "—"
    if len(groups) == 2:
        g1, g2 = groups[0], groups[1]
        lr = logrank_test(df[df["g"] == g1]["t"], df[df["g"] == g2]["t"], df[df["g"] == g1]["e"], df[df["g"] == g2]["e"])
        lr_p_str = fp(float(lr.p_value))
        lr_note = f"Log-rank χ² = {rn(float(lr.test_statistic), 3)}, p = {lr_p_str}."
    elif len(groups) > 2:
        lr = multivariate_logrank_test(df["t"], df["g"], df["e"])
        lr_p_str = fp(float(lr.p_value))
        lr_note = f"Log-rank multigrupo χ² = {rn(float(lr.test_statistic), 3)}, p = {lr_p_str}."

    citations = build_library_citations([
        ("lifelines", "Estimador Kaplan-Meier con IC log-log de Greenwood y prueba log-rank (lifelines)"),
    ])
    return {
        "result": {
            "test": "kaplan_meier",
            "title": f"Supervivencia de Kaplan-Meier: {tv}",
            "summary": f"N = {len(df)}, eventos = {int(df['e'].sum())}" + (f", {lr_note}" if lr_note else "."),
            "tables": [{
                "title": "Resumen de supervivencia por grupo",
                "columns": ["Grupo", "N", "Eventos", "Mediana de supervivencia", "S(t) final"],
                "rows": summary_rows,
                "note": f"Intervalos de confianza mediante fórmula log-log de Greenwood. {lr_note}".strip(),
            }],
            "charts": [{"type": "survival", "title": f"Curva de Kaplan-Meier: {tv}", "x": "t", "series": groups, "data": chart_data, "meta": {"hasConfidenceIntervals": True, "logrank_p": lr_p_str}}],
        },
        "citations": citations,
        "warnings": [],
    }


def run_cox_ph(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    tv, ev = params["time"], params["event"]
    predictors: list[str] = params.get("predictors") or []
    if not predictors:
        raise WorkerStatsError("Selecciona al menos una covariable predictora para el modelo de Cox.")

    recs = []
    for r in rows:
        t_val, e_val = to_num(r.get(tv)), to_event01(r.get(ev))
        if t_val is None or e_val is None or t_val < 0:
            continue
        row_obj: dict[str, Any] = {"__time__": t_val, "__event__": e_val}
        ok = True
        for pv in predictors:
            ptype = var_map.get(pv, {}).get("type", "numeric")
            if ptype == "numeric":
                num = to_num(r.get(pv))
                if num is None:
                    ok = False
                    break
                row_obj[pv] = num
            else:
                lbl = to_lbl(r.get(pv))
                if lbl is None:
                    ok = False
                    break
                row_obj[pv] = lbl
        if ok:
            recs.append(row_obj)

    df = pd.DataFrame(recs)
    total_events = int(df["__event__"].sum()) if len(df) else 0
    if len(df) < len(predictors) + 5 or total_events < 3:
        raise WorkerStatsError("Insuficientes eventos o casos completos para ajustar la regresión de Cox.")

    X_parts = []
    for pv in predictors:
        ptype = var_map.get(pv, {}).get("type", "numeric")
        if ptype == "numeric":
            X_parts.append(df[[pv]].astype(float))
        else:
            cats = (var_map.get(pv, {}) or {}).get("levels") or sorted(df[pv].astype(str).unique().tolist())
            cat_s = pd.Categorical(df[pv].astype(str), categories=cats, ordered=(ptype == "ordinal"))
            X_parts.append(pd.get_dummies(cat_s, prefix=pv, prefix_sep=": ", drop_first=True, dtype=float))

    design_df = pd.concat([df[["__time__", "__event__"]], *X_parts], axis=1)
    cph = CoxPHFitter(penalizer=0.0)
    try:
        cph.fit(design_df, duration_col="__time__", event_col="__event__")
    except Exception:
        cph = CoxPHFitter(penalizer=0.01)
        cph.fit(design_df, duration_col="__time__", event_col="__event__")

    summ = cph.summary
    lr_test = cph.log_likelihood_ratio_test()
    lr_stat, lr_df, lr_p = float(lr_test.test_statistic), int(lr_test.degrees_freedom), float(lr_test.p_value)
    c_index = float(cph.concordance_index_)

    coef_rows, hr_chart = [], []
    for covar, r_s in summ.iterrows():
        hr = float(r_s["exp(coef)"])
        coef_rows.append([str(covar), rn(float(r_s["coef"]), 4), rn(float(r_s["se(coef)"]), 4), rn(float(r_s["z"]), 3), fp(float(r_s["p"])), rn(hr, 3), f"{rn(float(r_s['exp(coef) lower 95%']), 3)} – {rn(float(r_s['exp(coef) upper 95%']), 3)}"])
        hr_chart.append({"variable": str(covar), "HR": rn(hr, 3)})

    # Proportional Hazards Diagnostics (Schoenfeld residuals test)
    ph_rows = []
    warnings: list[str] = []
    try:
        ph_res = proportional_hazard_test(cph, design_df, time_transform="rank")
        ph_df = ph_res.summary
        for cov_idx, ph_r in ph_df.iterrows():
            stat_v = float(ph_r["test_statistic"])
            pv = float(ph_r["p"])
            ok_ph = pv >= 0.05
            if not ok_ph:
                warnings.append(f"Posible violación de riesgos proporcionales en '{cov_idx}' (Schoenfeld p={fp(pv)}).")
            ph_rows.append([str(cov_idx), rn(stat_v, 3), fp(pv), "Compatible (PH)" if ok_ph else "⚠ Revisar PH"])
    except Exception:
        pass

    tables = [
        {"title": "Ajuste global del modelo", "columns": ["N", "Eventos", "Concordancia (C-index)", "χ² (LR)", "gl", "p global"], "rows": [[int(len(design_df)), total_events, rn(c_index, 3), rn(lr_stat, 2), lr_df, fp(lr_p)]], "note": "Verosimilitud parcial de Cox con empates de Efron (lifelines)."},
        {"title": "Hazard Ratios ajustados (HR)", "columns": ["Covariable", "β", "EE", "Wald z", "p", "HR", "IC 95% HR"], "rows": coef_rows, "note": ""},
    ]
    if ph_rows:
        tables.append({
            "title": "Diagnóstico de riesgos proporcionales (Residuos de Schoenfeld)",
            "columns": ["Covariable", "χ² Schoenfeld", "p", "Supuesto PH"],
            "rows": ph_rows,
            "note": " ".join(warnings) if warnings else "p ≥ 0.05 indica cumplimiento del supuesto de riesgos proporcionales.",
        })

    citations = build_library_citations([
        ("lifelines", "Cox PH (CoxPHFitter) y diagnóstico de riesgos proporcionales de Schoenfeld (proportional_hazard_test)"),
    ])
    return {
        "result": {
            "test": "cox_ph",
            "title": f"Regresión de riesgos proporcionales de Cox: {tv} ({ev})",
            "summary": f"Modelo de Cox (N={len(design_df)}, {total_events} eventos): C-index = {rn(c_index, 3)}, χ² = {rn(lr_stat, 2)}, p global = {fp(lr_p)}.",
            "tables": tables,
            "charts": [{"type": "bar", "title": "Hazard Ratios (HR) ajustados", "x": "variable", "series": ["HR"], "data": hr_chart, "meta": {"refline": 1}}],
        },
        "citations": citations,
        "warnings": warnings,
    }


# =============================================================================
# 7. Inferencia y Planificación (Sample Size, Power & Multiple Testing)
# =============================================================================

def run_sample_size(params: dict[str, Any]) -> dict[str, Any]:
    calc_mode = str(params.get("calc_mode", "sample_size"))
    design = str(params.get("design", "two_proportions"))
    alpha = min(0.25, max(0.001, float(params.get("alpha", 0.05))))
    power = min(0.99, max(0.5, float(params.get("power", 0.8))))
    ratio = min(10.0, max(0.1, float(params.get("ratio", 1.0))))
    z_a = float(sp_stats.norm.ppf(1.0 - alpha / 2.0))

    def compute_power_for_n1(n1_v: float) -> float:
        if design == "two_means":
            diff = abs(float(params.get("diff", 10.0)))
            sd_v = max(1e-6, float(params.get("sd_val", 15.0)))
            es = diff / sd_v
            return float(TTestIndPower().power(effect_size=es, nobs1=n1_v, alpha=alpha, ratio=ratio, alternative="two-sided"))
        if design == "correlation":
            r = min(0.99, max(0.05, abs(float(params.get("r_val", 0.3)))))
            zr = 0.5 * math.log((1.0 + r) / (1.0 - r))
            return float(sp_stats.norm.cdf(zr * math.sqrt(max(1.0, n1_v - 3.0)) - z_a)) if n1_v > 3 else 0.0
        if design == "cohort_rr":
            p2 = min(0.99, max(0.01, float(params.get("p2", 0.15))))
            rr = max(1.05, float(params.get("rr_val", 2.0)))
            p1 = min(0.99, p2 * rr)
        else:
            p1 = min(0.99, max(0.01, float(params.get("p1", 0.3))))
            p2 = min(0.99, max(0.01, float(params.get("p2", 0.15))))
        h = 2.0 * (math.asin(math.sqrt(p1)) - math.asin(math.sqrt(p2)))
        return float(NormalIndPower().power(effect_size=abs(h), nobs1=n1_v, alpha=alpha, ratio=ratio, alternative="two-sided"))

    if calc_mode == "power":
        n1 = max(3, int(params.get("n1", 50)))
        n2 = 0 if design == "correlation" else math.ceil(n1 * ratio)
        ach_pwr = compute_power_for_n1(float(n1))
        n_tot = n1 + n2
        curve = []
        max_n = max(20, int(n1 * 2))
        step = max(1, max_n // 12)
        for k in range(max(5, step), max_n + 1, step):
            tot = k if design == "correlation" else math.ceil(k * (1 + ratio))
            curve.append({"N": f"N={tot}", "Potencia (%)": rn(compute_power_for_n1(float(k)) * 100.0, 1)})
        citations = build_library_citations([("statsmodels", "Cálculo de potencia estadística lograda (statsmodels.stats.power)")])
        return {
            "result": {
                "test": "sample_size",
                "title": "Cálculo de potencia estadística alcanzada",
                "summary": f"Con N = {n_tot} (α={alpha}), potencia estadística alcanzada (1 − β) = {rn(ach_pwr * 100.0, 1)}%.",
                "tables": [{
                    "title": f"Diseño: {design}",
                    "columns": ["Parámetro", "Valor"],
                    "rows": [
                        ["Nivel de significación (α bilateral)", alpha],
                        ["Grupo 1 (n₁)" if design != "correlation" else "Muestra total (N)", n1],
                        *([["Grupo 2 (n₂)", n2]] if design != "correlation" else []),
                        ["Tamaño muestral total (N)", n_tot],
                        ["Potencia estadística alcanzada (1 − β)", f"{rn(ach_pwr * 100.0, 1)}%"],
                    ],
                    "note": "Potencia ≥ 80% es el estándar clínico habitual para minimizar error tipo II (β ≤ 0.20).",
                }],
                "charts": [{"type": "bar", "title": "Curva de potencia vs N", "x": "N", "series": ["Potencia (%)"], "data": curve, "meta": {}}],
            },
            "citations": citations,
            "warnings": [],
        }

    # Sample size solve mode
    if design == "two_means":
        diff = abs(float(params.get("diff", 10.0)))
        sd_v = max(1e-6, float(params.get("sd_val", 15.0)))
        n1 = math.ceil(float(TTestIndPower().solve_power(effect_size=diff / sd_v, alpha=alpha, power=power, ratio=ratio, alternative="two-sided")))
        n2 = math.ceil(n1 * ratio)
        desc = f"2 medias independientes (Δ={diff}, DE={sd_v})"
    elif design == "correlation":
        r = min(0.99, max(0.05, abs(float(params.get("r_val", 0.3)))))
        zr = 0.5 * math.log((1.0 + r) / (1.0 - r))
        zb = float(sp_stats.norm.ppf(power))
        n1 = math.ceil(((z_a + zb) / zr) ** 2 + 3)
        n2 = 0
        desc = f"Correlación lineal (r={r})"
    else:
        if design == "cohort_rr":
            p2 = min(0.99, max(0.01, float(params.get("p2", 0.15))))
            rr = max(1.05, float(params.get("rr_val", 2.0)))
            p1 = min(0.99, p2 * rr)
            desc = f"Cohorte RR={rr} (p₀={rn(p2*100,1)}%, p₁={rn(p1*100,1)}%)"
        else:
            p1 = min(0.99, max(0.01, float(params.get("p1", 0.3))))
            p2 = min(0.99, max(0.01, float(params.get("p2", 0.15))))
            if abs(p1 - p2) < 0.005:
                raise WorkerStatsError("Las proporciones p1 y p2 deben ser distintas.")
            desc = f"2 proporciones (p₁={rn(p1*100,1)}% vs p₂={rn(p2*100,1)}%)"
        h = abs(2.0 * (math.asin(math.sqrt(p1)) - math.asin(math.sqrt(p2))))
        n1 = math.ceil(float(NormalIndPower().solve_power(effect_size=h, alpha=alpha, power=power, ratio=ratio, alternative="two-sided")))
        n2 = math.ceil(n1 * ratio)

    n_tot = n1 + n2
    n_tot15 = math.ceil(n_tot / 0.85)
    curve = []
    max_n = max(20, math.ceil(n1 * 1.6))
    step = max(1, max_n // 12)
    for k in range(max(5, step), max_n + 1, step):
        tot = k if design == "correlation" else math.ceil(k * (1 + ratio))
        curve.append({"N": f"N={tot}", "Potencia (%)": rn(compute_power_for_n1(float(k)) * 100.0, 1)})

    citations = build_library_citations([
        ("statsmodels", "Cálculo de tamaño muestral y potencia (statsmodels.stats.power)"),
    ])
    return {
        "result": {
            "test": "sample_size",
            "title": "Cálculo de tamaño muestral y potencia estadística",
            "summary": f"Tamaño muestral necesario: N = {n_tot} ({n_tot15} ajustado +15% pérdidas) para α={alpha}, potencia={rn(power * 100, 0)}%.",
            "tables": [{
                "title": desc,
                "columns": ["Parámetro", "Valor"],
                "rows": [
                    ["Nivel de significación (α bilateral)", alpha],
                    ["Potencia estadística (1 − β)", f"{rn(power * 100, 0)}%"],
                    ["Sujetos grupo 1 (n₁)" if design != "correlation" else "Sujetos requeridos (N)", n1],
                    *([["Sujetos grupo 2 (n₂)", n2]] if design != "correlation" else []),
                    ["Tamaño muestral total (N)", n_tot],
                    ["Ajustado por 15% pérdidas", n_tot15],
                ],
                "note": "Aproximación de Cohen h / NormalIndPower / TTestIndPower.",
            }],
            "charts": [{"type": "bar", "title": "Curva de potencia según N", "x": "N", "series": ["Potencia (%)"], "data": curve, "meta": {}}],
        },
        "citations": citations,
        "warnings": [],
    }


def run_multiple_testing(rows: list[dict[str, Any]], params: dict[str, Any], var_map: dict[str, dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
    mode = str(params.get("mode", "screen"))
    method = str(params.get("method", "fdr_bh"))
    alpha = float(options.get("alpha", 0.05))
    items: list[tuple[str, str, float]] = []

    if mode == "pvalues":
        pvals = [float(x) for x in (params.get("pvalues") or [])]
        labels = params.get("labels") or [f"Hipótesis {i + 1}" for i in range(len(pvals))]
        if len(pvals) < 2:
            raise WorkerStatsError("Introduce al menos 2 valores p para aplicar corrección múltiple.")
        for idx, pv in enumerate(pvals):
            lbl = str(labels[idx]) if idx < len(labels) else f"Hipótesis {idx + 1}"
            items.append((lbl, "Valor p directo", pv))
    else:
        gv = params.get("group")
        vars_list: list[str] = params.get("vars") or []
        if not gv or not vars_list:
            raise WorkerStatsError("Selecciona la variable de agrupación y al menos 2 variables de resultado.")
        g_raw = [to_lbl(r.get(gv)) for r in rows]
        levels = list(dict.fromkeys([g for g in g_raw if g is not None]))
        if len(levels) < 2:
            raise WorkerStatsError(f"La agrupación '{gv}' necesita al menos 2 categorías.")
        for v in vars_list:
            if v == gv:
                continue
            vtype = var_map.get(v, {}).get("type", "numeric")
            if vtype in ("numeric", "ordinal"):
                s = extract_aligned_series(rows, v, var_map)
                grps = [np.asarray([s[i] for i in range(len(rows)) if g_raw[i] == lv and s[i] is not None], dtype=float) for lv in levels]
                grps = [g for g in grps if g.size > 0]
                if len(grps) < 2:
                    continue
                if len(grps) == 2:
                    _, p_mw = sp_stats.mannwhitneyu(grps[0], grps[1], alternative="two-sided")
                    items.append((v, "Mann-Whitney U", float(p_mw)))
                else:
                    _, p_kw = sp_stats.kruskal(*grps)
                    items.append((v, "Kruskal-Wallis", float(p_kw)))
            else:
                pairs = [(to_lbl(rows[i].get(v)), g_raw[i]) for i in range(len(rows)) if to_lbl(rows[i].get(v)) is not None and g_raw[i] is not None]
                if pairs:
                    ct = pd.crosstab(pd.Series([p[0] for p in pairs]), pd.Series([p[1] for p in pairs]))
                    if ct.shape[0] >= 2 and ct.shape[1] >= 2:
                        _, p_c, _, _ = sp_stats.chi2_contingency(ct.values, correction=False)
                        items.append((v, "χ² Pearson", float(p_c)))
        if len(items) < 2:
            raise WorkerStatsError("Se requieren al menos 2 comparaciones válidas para corregir multiplicidad.")

    raw_p = [it[2] for it in items]
    _, p_bonf, _, _ = multipletests(raw_p, alpha=alpha, method="bonferroni")
    _, p_holm, _, _ = multipletests(raw_p, alpha=alpha, method="holm")
    _, p_fdr, _, _ = multipletests(raw_p, alpha=alpha, method="fdr_bh")
    active = p_fdr if method == "fdr_bh" else p_holm if method == "holm" else p_bonf

    out_rows = []
    sig_raw, sig_adj = 0, 0
    for idx, (name, tst, pr) in enumerate(items):
        if pr < alpha:
            sig_raw += 1
        if float(active[idx]) < alpha:
            sig_adj += 1
        out_rows.append([name, tst, fp(pr), fp(float(p_bonf[idx])), fp(float(p_holm[idx])), fp(float(p_fdr[idx])), "Sí" if float(active[idx]) < alpha else "No"])

    method_lbl = {"fdr_bh": "Benjamini-Hochberg (FDR)", "holm": "Holm-Bonferroni", "bonferroni": "Bonferroni"}[method]
    citations = build_library_citations([
        ("statsmodels", "Corrección por comparaciones múltiples Bonferroni, Holm y Benjamini-Hochberg FDR (statsmodels.stats.multitest.multipletests)"),
    ])
    return {
        "result": {
            "test": "multiple_testing",
            "title": f"Corrección por comparaciones múltiples ({method_lbl})",
            "summary": f"{len(items)} contrastes evaluados: {sig_raw} significativos sin corregir vs {sig_adj} significativos tras {method_lbl} (α={alpha}).",
            "tables": [{
                "title": "Valores p brutos y ajustados",
                "columns": ["Variable / Hipótesis", "Prueba", "p bruta", "p Bonferroni", "p Holm", "q FDR (BH)", f"Significativo ({method})"],
                "rows": out_rows,
                "note": "Benjamini-Hochberg (FDR) controla la tasa de falsos descubrimientos; Holm y Bonferroni controlan el error tipo I familiar (FWER).",
            }],
            "charts": [],
        },
        "citations": citations,
        "warnings": [],
    }


# =============================================================================
# 8. Series Temporales
# =============================================================================

def _extract_ordered_series(rows: list[dict[str, Any]], outcome: str, time_col: str | None) -> tuple[list[str], np.ndarray]:
    items: list[tuple[Any, str, float]] = []
    for idx, r in enumerate(rows):
        yv = to_num(r.get(outcome))
        if yv is None:
            continue
        if time_col:
            raw_t = to_lbl(r.get(time_col))
            if raw_t is None:
                continue
            num_t = to_num(raw_t)
            sort_k = (0, num_t) if num_t is not None else (1, raw_t)
            items.append((sort_k, raw_t, yv))
        else:
            items.append(((0, idx), f"t={idx + 1}", yv))
    if time_col:
        items.sort(key=lambda x: x[0])
    if len(items) < 6:
        raise WorkerStatsError("Se requieren al menos 6 puntos temporales válidos para analizar series temporales.")
    labels = [it[1] for it in items]
    arr = np.asarray([it[2] for it in items], dtype=float)
    return labels, arr


def run_ts_trend_seasonal(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    outcome = params["outcome"]
    time_col = params.get("time")
    period = int(params.get("period", 12))
    labels, y = _extract_ordered_series(rows, outcome, time_col)
    n = int(y.size)
    t_idx = np.arange(n, dtype=float)

    # Mann-Kendall trend test + Theil-Sen slope + OLS slope
    tau_mk, p_mk = sp_stats.kendalltau(t_idx, y)
    sen_res = sp_stats.theilslopes(y, t_idx)
    sen_slope = float(sen_res.slope)
    ols_res = sp_stats.linregress(t_idx, y)

    # Seasonal decomposition if N >= 2 * period
    decomp_rows: list[list[Any]] = []
    trend_strength, seasonal_strength = None, None
    trend_line = [float(ols_res.intercept + ols_res.slope * i) for i in range(n)]
    seasonal_adj = y.tolist()
    effective_period = period
    if n >= max(4, 2 * period):
        decomp = seasonal_decompose(y, model="additive", period=period, extrapolate_trend="freq")
        tr = np.asarray(decomp.trend, dtype=float)
        seas = np.asarray(decomp.seasonal, dtype=float)
        res_comp = np.asarray(decomp.resid, dtype=float)
        var_r = float(np.nanvar(res_comp))
        var_sr = float(np.nanvar(seas + res_comp))
        var_tr = float(np.nanvar(tr + res_comp))
        seasonal_strength = max(0.0, 1.0 - var_r / var_sr) if var_sr > 0 else 0.0
        trend_strength = max(0.0, 1.0 - var_r / var_tr) if var_tr > 0 else 0.0
        trend_line = [float(v) if math.isfinite(float(v)) else float(y[i]) for i, v in enumerate(tr)]
        seasonal_adj = [float(y[i] - seas[i]) for i in range(n)]
        for phase in range(period):
            decomp_rows.append([f"Fase {phase + 1}", rn(float(seas[phase]), 3)])
    else:
        effective_period = 0

    chart_step = max(1, n // 150)
    chart_data = [
        {"t": labels[i], "Observado": rn(float(y[i]), 3), "Tendencia": rn(trend_line[i], 3), **({"Desestacionalizada": rn(seasonal_adj[i], 3)} if effective_period else {})}
        for i in range(0, n, chart_step)
    ]

    tables = [{
        "title": "Análisis de tendencia (Mann-Kendall, Theil-Sen y OLS)",
        "columns": ["N puntos", "τ Mann-Kendall", "p (Mann-Kendall)", "Pendiente Theil-Sen", "Pendiente OLS", "R² lineal", "p (OLS)", "Fuerza tendencia (F_T)", "Fuerza estacional (F_S)"],
        "rows": [[n, rn(float(tau_mk), 3), fp(float(p_mk)), rn(sen_slope, 4), rn(float(ols_res.slope), 4), rn(float(ols_res.rvalue) ** 2, 3), fp(float(ols_res.pvalue)), rn(trend_strength, 3) if trend_strength is not None else "—", rn(seasonal_strength, 3) if seasonal_strength is not None else "—"]],
        "note": f"Descomposición estacional aditiva con período={period}." if effective_period else f"Se requieren al menos {2 * period} puntos para descomposición estacional de período {period}; se reporta tendencia global.",
    }]
    if decomp_rows:
        tables.append({"title": f"Índices estacionales aditivos (período = {period})", "columns": ["Fase del ciclo", "Efecto estacional"], "rows": decomp_rows, "note": ""})

    citations = build_library_citations([
        ("scipy", "Prueba de tendencia Mann-Kendall y estimador robusto de Theil-Sen (scipy.stats)"),
        ("statsmodels", "Descomposición estacional clásica (statsmodels.tsa.seasonal.seasonal_decompose)"),
    ])
    return {
        "result": {
            "test": "ts_trend_seasonal",
            "title": f"Tendencia y estacionalidad: {outcome}",
            "summary": f"Mann-Kendall τ = {rn(float(tau_mk), 3)} (p = {fp(float(p_mk))}), pendiente Theil-Sen = {rn(sen_slope, 4)}/unidad"
            + (f", fuerza estacional = {rn(seasonal_strength, 3)}." if seasonal_strength is not None else "."),
            "tables": tables,
            "charts": [{"type": "line", "title": f"Serie temporal y tendencia: {outcome}", "x": "t", "series": ["Observado", "Tendencia", *(["Desestacionalizada"] if effective_period else [])], "data": chart_data, "meta": {}}],
        },
        "citations": citations,
        "warnings": [],
    }


def run_ts_arima(rows: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    outcome = params["outcome"]
    time_col = params.get("time")
    p_ord = int(params.get("p", 1))
    d_ord = int(params.get("d", 1))
    q_ord = int(params.get("q", 1))
    steps = int(params.get("forecast_steps", 6))
    auto_order = bool(params.get("auto_order", True))

    labels, y = _extract_ordered_series(rows, outcome, time_col)
    n = int(y.size)
    if n < 10:
        raise WorkerStatsError("ARIMA requiere al menos 10 observaciones temporales.")

    # ADF stationarity + ACF/PACF + Ljung-Box
    adf_stat, adf_p = 0.0, 1.0
    if np.std(y) > 0:
        adf_r = adfuller(y, autolag="AIC")
        adf_stat, adf_p = float(adf_r[0]), float(adf_r[1])

    nlags = max(2, min(16, n // 2 - 1))
    acf_vals = acf(y, nlags=nlags, fft=False)
    pacf_vals = pacf(y, nlags=min(nlags, max(1, n // 2 - 2)), method="ywm")
    lb_df = acorr_ljungbox(y, lags=[min(10, nlags)], return_df=True)
    lb_q = float(lb_df["lb_stat"].iloc[-1])
    lb_p = float(lb_df["lb_pvalue"].iloc[-1])

    chosen_order = (p_ord, d_ord, q_ord)
    best_fit = None
    if auto_order:
        best_aic = float("inf")
        d_cands = [0, 1] if adf_p < 0.05 else [1, 0]
        for dc in d_cands:
            for pc in (0, 1, 2):
                for qc in (0, 1, 2):
                    if pc + dc + qc >= max(3, n // 3):
                        continue
                    try:
                        cand = ARIMA(y, order=(pc, dc, qc)).fit()
                        if math.isfinite(float(cand.aic)) and float(cand.aic) < best_aic:
                            best_aic = float(cand.aic)
                            best_fit = cand
                            chosen_order = (pc, dc, qc)
                    except Exception:
                        continue
    if best_fit is None:
        best_fit = ARIMA(y, order=chosen_order).fit()

    fitted = np.asarray(best_fit.fittedvalues, dtype=float)
    rmse = math.sqrt(float(mean_squared_error(y[chosen_order[1]:], fitted[chosen_order[1]:]))) if n > chosen_order[1] else 0.0
    resid_lb = acorr_ljungbox(best_fit.resid, lags=[min(10, max(1, nlags // 2))], return_df=True)
    res_lb_p = float(resid_lb["lb_pvalue"].iloc[-1])

    fc = best_fit.get_forecast(steps=steps)
    fc_mean = np.asarray(fc.predicted_mean, dtype=float)
    fc_ci = np.asarray(fc.conf_int(alpha=0.05), dtype=float)

    coef_rows = []
    for name in best_fit.param_names:
        b = float(best_fit.params[best_fit.param_names.index(name)])
        se = float(best_fit.bse[best_fit.param_names.index(name)])
        z = float(best_fit.tvalues[best_fit.param_names.index(name)])
        pv = float(best_fit.pvalues[best_fit.param_names.index(name)])
        coef_rows.append([str(name), rn(b, 4), rn(se, 4), rn(z, 3), fp(pv)])

    acf_chart = [{"lag": f"Lag {k}", "ACF": rn(float(acf_vals[k]), 3), "PACF": rn(float(pacf_vals[k]), 3) if k < len(pacf_vals) else 0.0} for k in range(1, len(acf_vals))]
    tail_idx = max(0, n - 40)
    line_data: list[dict[str, Any]] = [
        {"t": labels[i], "Observado": rn(float(y[i]), 3), "Ajustado ARIMA": rn(float(fitted[i]), 3)}
        for i in range(tail_idx, n)
    ]
    for h in range(steps):
        line_data.append({
            "t": f"+{h + 1}",
            "Pronóstico ARIMA": rn(float(fc_mean[h]), 3),
            "IC95% inf": rn(float(fc_ci[h, 0]), 3),
            "IC95% sup": rn(float(fc_ci[h, 1]), 3),
        })

    citations = build_library_citations([
        ("statsmodels", "ADF, ACF/PACF, Ljung-Box y modelado ARIMA con pronóstico (statsmodels.tsa)"),
        ("scikit-learn", "Error cuadrático medio RMSE en ajuste ARIMA (scikit-learn)"),
    ])
    return {
        "result": {
            "test": "ts_arima",
            "title": f"Autocorrelación y ARIMA{chosen_order}: {outcome}",
            "summary": f"ARIMA{chosen_order}: AIC = {rn(float(best_fit.aic), 1)}, BIC = {rn(float(best_fit.bic), 1)}, RMSE = {rn(rmse, 3)}; ADF p = {fp(adf_p)}, Ljung-Box residuos p = {fp(res_lb_p)}.",
            "tables": [
                {
                    "title": "Diagnóstico de estacionariedad, autocorrelación y ajuste ARIMA",
                    "columns": ["Orden (p,d,q)", "N", "ADF estadístico", "p (ADF)", "Ljung-Box serie (p)", "AIC", "BIC", "RMSE", "Ljung-Box residuos (p)"],
                    "rows": [[str(chosen_order), n, rn(adf_stat, 3), fp(adf_p), fp(lb_p), rn(float(best_fit.aic), 1), rn(float(best_fit.bic), 1), rn(rmse, 3), fp(res_lb_p)]],
                    "note": "ADF p < 0.05 indica estacionariedad; Ljung-Box residuos p ≥ 0.05 indica residuos compatibles con ruido blanco.",
                },
                {"title": "Parámetros del modelo ARIMA", "columns": ["Parámetro", "Coeficiente", "EE", "z", "p"], "rows": coef_rows, "note": ""},
                {
                    "title": f"Pronóstico a {steps} pasos (IC 95%)",
                    "columns": ["Horizonte", "Pronóstico puntual", "IC 95% inf", "IC 95% sup"],
                    "rows": [[f"+{h + 1}", rn(float(fc_mean[h]), 3), rn(float(fc_ci[h, 0]), 3), rn(float(fc_ci[h, 1]), 3)] for h in range(steps)],
                    "note": "",
                },
            ],
            "charts": [
                {"type": "line", "title": f"Ajuste y pronóstico ARIMA{chosen_order}", "x": "t", "series": ["Observado", "Ajustado ARIMA", "Pronóstico ARIMA", "IC95% inf", "IC95% sup"], "data": line_data, "meta": {}},
                {"type": "bar", "title": "Autocorrelación (ACF y PACF por rezago)", "x": "lag", "series": ["ACF", "PACF"], "data": acf_chart, "meta": {"refZero": True}},
            ],
        },
        "citations": citations,
        "warnings": [],
    }


def dispatch_test(spec: dict[str, Any], variables: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, Any]:
    test = spec["test"]
    params = spec.get("params") or {}
    options = spec.get("options") or {}
    seed = int(options.get("seed", 42))
    np.random.seed(seed)
    var_map = get_var_meta(variables)

    if test == "sample_size":
        return run_sample_size(params)
    if test == "multiple_testing" and params.get("mode") == "pvalues":
        return run_multiple_testing(rows, params, var_map, options)
    if not rows:
        raise WorkerStatsError("La base de datos no tiene registros.")

    if test == "descriptives":
        return run_descriptives(rows, params, var_map, options)
    if test == "frequencies":
        return run_frequencies(rows, params)
    if test == "table1":
        return run_table1(rows, params, var_map, options)
    if test == "outlier_detection":
        return run_outlier_detection(rows, params, var_map)
    if test == "missing_analysis":
        return run_missing_analysis(rows, params, var_map)
    if test == "ttest":
        return run_ttest(rows, params, var_map, options)
    if test == "paired_ttest":
        return run_paired_ttest(rows, params, var_map, options)
    if test == "mannwhitney":
        return run_mannwhitney(rows, params, var_map)
    if test == "chi2":
        return run_chi2(rows, params)
    if test == "anova":
        return run_anova(rows, params, var_map)
    if test == "rm_anova":
        return run_rm_anova(rows, params, var_map)
    if test == "friedman":
        return run_friedman(rows, params, var_map)
    if test == "mcnemar":
        return run_mcnemar(rows, params)
    if test == "correlation":
        return run_correlation(rows, params, var_map)
    if test == "kappa_agreement":
        return run_kappa(rows, params)
    if test == "icc":
        return run_icc(rows, params, var_map, options)
    if test == "linreg":
        return run_linreg(rows, params, var_map, options)
    if test == "logreg":
        return run_logreg(rows, params, var_map, options)
    if test == "poisson_reg":
        return run_poisson_reg(rows, params, var_map, options)
    if test == "negbin_reg":
        return run_negbin_reg(rows, params, var_map, options)
    if test == "epidemiology_2x2":
        return run_epidemiology_2x2(rows, params)
    if test == "incidence_prevalence":
        return run_incidence_prevalence(rows, params)
    if test == "diagnostic_test":
        return run_diagnostic_test(rows, params)
    if test == "roc_auc":
        return run_roc_auc(rows, params, var_map)
    if test == "kaplan_meier":
        return run_kaplan_meier(rows, params, options)
    if test == "cox_ph":
        return run_cox_ph(rows, params, var_map, options)
    if test == "multiple_testing":
        return run_multiple_testing(rows, params, var_map, options)
    if test == "ts_trend_seasonal":
        return run_ts_trend_seasonal(rows, params)
    if test == "ts_arima":
        return run_ts_arima(rows, params)

    raise WorkerStatsError(f"UNSUPPORTED_TEST:{test}")
