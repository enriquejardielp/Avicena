"""Python statistical engine (Stata/SPSS-style tests) returning tables + chart data."""

import re
import warnings
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats
from statsmodels.duration.survfunc import SurvfuncRight, survdiff
from statsmodels.stats.multicomp import pairwise_tukeyhsd

warnings.filterwarnings("ignore")


class StatsError(ValueError):
    pass


def fp(p) -> str:
    if p is None or not np.isfinite(p):
        return "—"
    return "<0.001" if p < 0.001 else f"{p:.3f}"


def r(x, n: int = 3):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, n) if np.isfinite(x) else None


def _lbl(v) -> str | None:
    if v is None or (isinstance(v, float) and np.isnan(v)) or v == "":
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _need(df: pd.DataFrame, *cols: str):
    for c in cols:
        if not c or c not in df.columns:
            raise StatsError(f"Variable no encontrada: {c or '(vacía)'}")


def num(df, col) -> pd.Series:
    _need(df, col)
    return pd.to_numeric(df[col], errors="coerce")


def cat(df, col) -> pd.Series:
    _need(df, col)
    return df[col].map(_lbl)


def _levels(s: pd.Series) -> list[str]:
    vals = s.dropna().unique().tolist()
    try:
        return sorted(vals, key=lambda v: float(v))
    except ValueError:
        return sorted(vals)


def box_stats(values: pd.Series, name: str) -> dict:
    v = values.dropna().to_numpy()
    if len(v) == 0:
        return {"group": name, "n": 0}
    q1, med, q3 = np.percentile(v, [25, 50, 75])
    iqr = q3 - q1
    lo = v[v >= q1 - 1.5 * iqr].min()
    hi = v[v <= q3 + 1.5 * iqr].max()
    return {"group": name, "n": int(len(v)), "min": r(lo), "q1": r(q1), "median": r(med),
            "q3": r(q3), "max": r(hi), "mean": r(v.mean())}


def histogram(values: pd.Series, title: str) -> dict:
    v = values.dropna().to_numpy()
    if len(v) == 0:
        return {"type": "histogram", "title": title, "data": []}
    bins = min(20, max(5, int(np.sqrt(len(v)))))
    counts, edges = np.histogram(v, bins=bins)
    data = [{"bin": f"{r(edges[i], 1)}–{r(edges[i + 1], 1)}", "mid": r((edges[i] + edges[i + 1]) / 2), "count": int(c)}
            for i, c in enumerate(counts)]
    return {"type": "histogram", "title": title, "data": data, "x": "bin", "series": ["count"]}


def _box_chart(y: pd.Series, g: pd.Series, title: str) -> dict:
    data = [box_stats(y[g == lv], lv) for lv in _levels(g)]
    return {"type": "box", "title": title, "data": data, "x": "group"}


def _two_groups(y, g, var):
    levels = _levels(g)
    if len(levels) != 2:
        raise StatsError(f"La variable de agrupación '{var}' debe tener exactamente 2 categorías (tiene {len(levels)}).")
    return levels


# ---------------------------------------------------------------- tests
def descriptives(df, p):
    variables = p.get("vars") or []
    if not variables:
        raise StatsError("Selecciona al menos una variable.")
    rows, tables, charts = [], [], []
    for v in variables:
        s = num(df, v)
        if s.notna().sum() >= max(3, 0.5 * df[v].notna().sum()):
            x = s.dropna()
            q1, med, q3 = np.percentile(x, [25, 50, 75]) if len(x) else (np.nan,) * 3
            sw = stats.shapiro(x[:5000])[1] if len(x) >= 3 else np.nan
            rows.append([v, int(len(x)), int(len(df) - len(x)), r(x.mean(), 2), r(x.std(), 2), r(med, 2),
                         f"{r(q1, 2)} – {r(q3, 2)}", r(x.min(), 2), r(x.max(), 2), fp(sw)])
            if len(charts) < 2:
                charts.append(histogram(x, f"Distribución de {v}"))
        else:
            c = cat(df, v)
            vc = c.value_counts()
            tables.append({"title": f"Frecuencias: {v}", "columns": ["Categoría", "n", "%"],
                           "rows": [[k, int(n), r(100 * n / vc.sum(), 1)] for k, n in vc.items()]})
    if rows:
        tables.insert(0, {"title": "Estadística descriptiva", "columns": [
            "Variable", "N", "Perdidos", "Media", "DE", "Mediana", "RIC (Q1–Q3)", "Mín", "Máx", "Shapiro-Wilk p"],
            "rows": rows, "note": "Shapiro-Wilk p < 0.05 sugiere distribución no normal."})
    return {"title": "Estadística descriptiva", "tables": tables, "charts": charts,
            "summary": f"Descriptivos de {len(variables)} variable(s), N total = {len(df)}."}


def frequencies(df, p):
    v = p.get("var")
    c = cat(df, v)
    vc = c.value_counts().reindex(_levels(c))
    total, valid = len(c), int(vc.sum())
    cum, rows = 0.0, []
    for k, n in vc.items():
        pct = 100 * n / valid if valid else 0
        cum += pct
        rows.append([k, int(n), r(100 * n / total, 1), r(pct, 1), r(cum, 1)])
    miss = total - valid
    if miss:
        rows.append(["Perdidos", miss, r(100 * miss / total, 1), None, None])
    chart = {"type": "bar", "title": f"Frecuencias de {v}", "x": "category", "series": ["n"],
             "data": [{"category": k, "n": int(n)} for k, n in vc.items()]}
    return {"title": f"Tabla de frecuencias: {v}",
            "tables": [{"title": f"Frecuencias: {v}", "columns": ["Categoría", "n", "%", "% válido", "% acumulado"], "rows": rows}],
            "charts": [chart], "summary": f"{len(vc)} categorías, {valid} casos válidos, {miss} perdidos."}


def _group_table(y, g, levels):
    rows = []
    for lv in levels:
        x = y[g == lv].dropna()
        rows.append([lv, int(len(x)), r(x.mean(), 2), r(x.std(), 2), r(x.std() / np.sqrt(len(x)) if len(x) else np.nan, 3), r(x.median(), 2)])
    return rows


def ttest(df, p):
    yv, gv = p.get("outcome"), p.get("group")
    y, g = num(df, yv), cat(df, gv)
    a, b = _two_groups(y, g, gv)
    xa, xb = y[g == a].dropna(), y[g == b].dropna()
    if len(xa) < 2 or len(xb) < 2:
        raise StatsError("Cada grupo necesita al menos 2 observaciones.")
    lev = stats.levene(xa, xb)
    diff = xa.mean() - xb.mean()
    out = []
    for name, eq in [("Varianzas iguales (Student)", True), ("Varianzas desiguales (Welch)", False)]:
        t = stats.ttest_ind(xa, xb, equal_var=eq)
        ci = t.confidence_interval(0.95)
        out.append([name, r(t.statistic), r(t.df, 1), fp(t.pvalue), r(diff, 3), r(ci.low, 3), r(ci.high, 3)])
    sp = np.sqrt(((len(xa) - 1) * xa.var() + (len(xb) - 1) * xb.var()) / (len(xa) + len(xb) - 2))
    d = diff / sp if sp else np.nan
    welch = stats.ttest_ind(xa, xb, equal_var=False)
    use = out[0] if lev.pvalue >= 0.05 else out[1]
    sig = "significativa" if (welch.pvalue if lev.pvalue < 0.05 else stats.ttest_ind(xa, xb).pvalue) < 0.05 else "no significativa"
    return {"title": f"T de Student: {yv} según {gv}",
            "tables": [
                {"title": "Estadísticos de grupo", "columns": ["Grupo", "N", "Media", "DE", "EE", "Mediana"], "rows": _group_table(y, g, [a, b])},
                {"title": "Prueba t para muestras independientes", "columns": ["Supuesto", "t", "gl", "p", "Diferencia", "IC95% inf", "IC95% sup"],
                 "rows": out, "note": f"Levene F = {r(lev.statistic)}, p = {fp(lev.pvalue)}. d de Cohen = {r(d)}."},
            ],
            "charts": [_box_chart(y, g, f"{yv} por {gv}")],
            "summary": f"Diferencia de medias ({a} − {b}) = {r(diff, 2)}; {use[0]}: t = {use[1]}, p = {use[3]} → diferencia {sig}. d de Cohen = {r(d, 2)}."}


def paired_ttest(df, p):
    v1, v2 = p.get("var1"), p.get("var2")
    x1, x2 = num(df, v1), num(df, v2)
    m = x1.notna() & x2.notna()
    if m.sum() < 3:
        raise StatsError("Se necesitan al menos 3 pares completos.")
    t = stats.ttest_rel(x1[m], x2[m])
    ci = t.confidence_interval(0.95)
    w = stats.wilcoxon(x1[m], x2[m])
    diff = (x1[m] - x2[m]).mean()
    return {"title": f"T pareada: {v1} vs {v2}",
            "tables": [
                {"title": "Estadísticos", "columns": ["Variable", "N", "Media", "DE"],
                 "rows": [[v, int(m.sum()), r(s[m].mean(), 2), r(s[m].std(), 2)] for v, s in [(v1, x1), (v2, x2)]]},
                {"title": "Prueba", "columns": ["Prueba", "Estadístico", "gl", "p", "Dif. media", "IC95% inf", "IC95% sup"],
                 "rows": [["t pareada", r(t.statistic), int(t.df), fp(t.pvalue), r(diff, 3), r(ci.low, 3), r(ci.high, 3)],
                          ["Wilcoxon rangos con signo", r(w.statistic), None, fp(w.pvalue), None, None, None]]},
            ],
            "charts": [{"type": "box", "title": "Comparación pareada", "x": "group",
                        "data": [box_stats(x1[m], v1), box_stats(x2[m], v2)]}],
            "summary": f"Diferencia media = {r(diff, 2)}, t = {r(t.statistic, 2)}, p = {fp(t.pvalue)}."}


def mannwhitney(df, p):
    yv, gv = p.get("outcome"), p.get("group")
    y, g = num(df, yv), cat(df, gv)
    a, b = _two_groups(y, g, gv)
    xa, xb = y[g == a].dropna(), y[g == b].dropna()
    u = stats.mannwhitneyu(xa, xb, alternative="two-sided")
    rbc = 1 - 2 * u.statistic / (len(xa) * len(xb))
    rows = [[lv, int(len(x)), r(x.median(), 2), f"{r(x.quantile(.25), 2)} – {r(x.quantile(.75), 2)}", r(x.rank().mean(), 1)]
            for lv, x in [(a, xa), (b, xb)]]
    return {"title": f"U de Mann-Whitney: {yv} según {gv}",
            "tables": [{"title": "Medianas por grupo", "columns": ["Grupo", "N", "Mediana", "RIC", "Rango medio"], "rows": rows},
                       {"title": "Prueba", "columns": ["U", "p", "Correlación biserial de rangos"], "rows": [[r(u.statistic, 1), fp(u.pvalue), r(rbc)]]}],
            "charts": [_box_chart(y, g, f"{yv} por {gv}")],
            "summary": f"U = {r(u.statistic, 1)}, p = {fp(u.pvalue)}."}


def chi2(df, p):
    rv, cv = p.get("row"), p.get("col")
    a, b = cat(df, rv), cat(df, cv)
    m = a.notna() & b.notna()
    ct = pd.crosstab(a[m], b[m])
    ct = ct.reindex(index=_levels(a[m]), columns=_levels(b[m]))
    if ct.shape[0] < 2 or ct.shape[1] < 2:
        raise StatsError("Ambas variables necesitan al menos 2 categorías.")
    chi, pv, dof, exp = stats.chi2_contingency(ct, correction=False)
    n = ct.to_numpy().sum()
    cramer = np.sqrt(chi / (n * (min(ct.shape) - 1)))
    cols = list(ct.columns)
    rows = []
    for idx, row in ct.iterrows():
        tot = row.sum()
        rows.append([idx] + [f"{int(v)} ({r(100 * v / tot, 1)}%)" for v in row] + [int(tot)])
    rows.append(["Total"] + [int(ct[c].sum()) for c in cols] + [int(n)])
    tests = [["Chi-cuadrado de Pearson", r(chi), int(dof), fp(pv)]]
    extra = ""
    if ct.shape == (2, 2):
        cy, py, _, _ = stats.chi2_contingency(ct, correction=True)
        tests.append(["Corrección de Yates", r(cy), 1, fp(py)])
        _, pf = stats.fisher_exact(ct)
        tests.append(["Exacta de Fisher", None, None, fp(pf)])
        t = ct.to_numpy().astype(float)
        if (t == 0).any():
            t = t + 0.5
        orr = (t[0, 0] * t[1, 1]) / (t[0, 1] * t[1, 0])
        se = np.sqrt((1 / t).sum())
        lo, hi = np.exp(np.log(orr) - 1.96 * se), np.exp(np.log(orr) + 1.96 * se)
        extra = f" OR = {r(orr, 2)} (IC95% {r(lo, 2)}–{r(hi, 2)})."
        tests.append([f"Odds Ratio ({ct.index[0]}/{ct.index[1]} × {cols[0]}/{cols[1]})", r(orr), None, f"IC95% {r(lo)}–{r(hi)}"])
    low = (exp < 5).mean() * 100
    chart = {"type": "groupedbar", "title": f"{rv} × {cv}", "x": "category", "series": cols,
             "data": [{"category": idx, **{c: int(row[c]) for c in cols}} for idx, row in ct.iterrows()]}
    return {"title": f"Chi-cuadrado: {rv} × {cv}",
            "tables": [{"title": "Tabla de contingencia n (% de fila)", "columns": [f"{rv} \\ {cv}"] + cols + ["Total"], "rows": rows},
                       {"title": "Pruebas de independencia", "columns": ["Prueba", "Valor", "gl", "p"], "rows": tests,
                        "note": f"V de Cramér = {r(cramer)}. {r(low, 1)}% de celdas con frecuencia esperada < 5."}],
            "charts": [chart],
            "summary": f"χ²({dof}) = {r(chi, 2)}, p = {fp(pv)}, V de Cramér = {r(cramer, 2)}.{extra}"}


def anova(df, p):
    yv, gv = p.get("outcome"), p.get("group")
    y, g = num(df, yv), cat(df, gv)
    levels = _levels(g[y.notna()])
    if len(levels) < 2:
        raise StatsError("La variable de agrupación necesita al menos 2 categorías.")
    groups = [y[g == lv].dropna() for lv in levels]
    f = stats.f_oneway(*groups)
    kw = stats.kruskal(*groups)
    allv = pd.concat(groups)
    ssb = sum(len(x) * (x.mean() - allv.mean()) ** 2 for x in groups)
    sst = ((allv - allv.mean()) ** 2).sum()
    eta = ssb / sst if sst else np.nan
    k, n = len(groups), len(allv)
    tables = [
        {"title": "Estadísticos por grupo", "columns": ["Grupo", "N", "Media", "DE", "EE", "Mediana"], "rows": _group_table(y, g, levels)},
        {"title": "ANOVA de un factor", "columns": ["Fuente", "SC", "gl", "MC", "F", "p"],
         "rows": [["Entre grupos", r(ssb, 2), k - 1, r(ssb / (k - 1), 2), r(f.statistic), fp(f.pvalue)],
                  ["Intra grupos", r(sst - ssb, 2), n - k, r((sst - ssb) / (n - k), 2), None, None],
                  ["Total", r(sst, 2), n - 1, None, None, None]],
         "note": f"η² = {r(eta)}. Kruskal-Wallis H = {r(kw.statistic)}, p = {fp(kw.pvalue)}."},
    ]
    m = y.notna() & g.notna()
    if k > 2:
        tk = pairwise_tukeyhsd(y[m].to_numpy(), g[m].to_numpy())
        res = tk._results_table.data[1:]
        tables.append({"title": "Post hoc: Tukey HSD", "columns": ["Grupo 1", "Grupo 2", "Dif. media", "p ajustada", "IC inf", "IC sup", "Rechaza H0"],
                       "rows": [[a, b, r(md), fp(pa), r(lo), r(hi), "Sí" if rej else "No"] for a, b, md, pa, lo, hi, rej in res]})
    return {"title": f"ANOVA: {yv} según {gv}", "tables": tables, "charts": [_box_chart(y, g, f"{yv} por {gv}")],
            "summary": f"F({k - 1}, {n - k}) = {r(f.statistic, 2)}, p = {fp(f.pvalue)}, η² = {r(eta, 3)}."}


def correlation(df, p):
    variables = p.get("vars") or []
    method = p.get("method", "pearson")
    if len(variables) < 2:
        raise StatsError("Selecciona al menos 2 variables numéricas.")
    data = {v: num(df, v) for v in variables}
    fn = stats.pearsonr if method == "pearson" else stats.spearmanr
    rows = []
    for v1 in variables:
        row = [v1]
        for v2 in variables:
            if v1 == v2:
                row.append("1")
                continue
            m = data[v1].notna() & data[v2].notna()
            if m.sum() < 3:
                row.append("—")
                continue
            res = fn(data[v1][m], data[v2][m])
            row.append(f"{r(res[0])} (p={fp(res[1])})")
        rows.append(row)
    charts, summary = [], f"Matriz de correlación ({'Pearson' if method == 'pearson' else 'Spearman'})."
    if len(variables) == 2:
        x, y = data[variables[0]], data[variables[1]]
        m = x.notna() & y.notna()
        lr = stats.linregress(x[m], y[m])
        pts = [{"x": r(a), "y": r(b)} for a, b in zip(x[m], y[m])][:800]
        charts.append({"type": "scatter", "title": f"{variables[1]} vs {variables[0]}", "data": pts,
                       "meta": {"slope": r(lr.slope, 4), "intercept": r(lr.intercept, 4), "xlabel": variables[0], "ylabel": variables[1],
                                "xmin": r(x[m].min()), "xmax": r(x[m].max())}})
        res = fn(x[m], y[m])
        summary = f"r = {r(res[0], 3)}, p = {fp(res[1])}, N = {int(m.sum())}."
    return {"title": f"Correlación de {'Pearson' if method == 'pearson' else 'Spearman'}",
            "tables": [{"title": "Coeficientes de correlación", "columns": [""] + variables, "rows": rows}],
            "charts": charts, "summary": summary}


def _q(name: str) -> str:
    return "Q('" + name.replace("'", "\\'") + "')"


def _clean_term(t: str) -> str:
    t = re.sub(r"C\(Q\('(.+?)'\)\)\[T\.(.+?)\]", r"\1: \2", t)
    t = re.sub(r"Q\('(.+?)'\)", r"\1", t)
    return "Constante" if t == "Intercept" else t


def _design(df, outcome, predictors, variables: dict, binary_outcome=False):
    if not outcome or not predictors:
        raise StatsError("Selecciona la variable dependiente y al menos un predictor.")
    _need(df, outcome, *predictors)
    d = pd.DataFrame()
    terms = []
    for pv in predictors:
        t = variables.get(pv, "numeric")
        if t in ("numeric",):
            d[pv] = num(df, pv)
            terms.append(_q(pv))
        else:
            d[pv] = cat(df, pv)
            terms.append(f"C({_q(pv)})")
    if binary_outcome:
        y = num(df, outcome)
        vals = set(y.dropna().unique())
        if not vals <= {0, 1}:
            c = cat(df, outcome)
            lv = _levels(c)
            if len(lv) != 2:
                raise StatsError(f"La variable dependiente '{outcome}' debe ser binaria (2 categorías).")
            y = c.map({lv[0]: 0, lv[1]: 1})
        d[outcome] = y
    else:
        d[outcome] = num(df, outcome)
    d = d.dropna()
    if len(d) < len(predictors) + 3:
        raise StatsError("No hay suficientes casos completos para el modelo.")
    return d, f"{_q(outcome)} ~ " + " + ".join(terms)


def linreg(df, p, variables):
    outcome, preds = p.get("outcome"), p.get("predictors") or []
    d, formula = _design(df, outcome, preds, variables)
    m = smf.ols(formula, data=d).fit()
    ci = m.conf_int()
    rows = [[_clean_term(t), r(m.params[t], 4), r(m.bse[t], 4), r(m.tvalues[t], 3), fp(m.pvalues[t]), r(ci.loc[t, 0], 4), r(ci.loc[t, 1], 4)]
            for t in m.params.index]
    charts = []
    if len(preds) == 1 and variables.get(preds[0], "numeric") == "numeric":
        pts = [{"x": r(a), "y": r(b)} for a, b in zip(d[preds[0]], d[outcome])][:800]
        charts.append({"type": "scatter", "title": f"{outcome} vs {preds[0]}", "data": pts,
                       "meta": {"slope": r(m.params.iloc[1], 4), "intercept": r(m.params.iloc[0], 4), "xlabel": preds[0], "ylabel": outcome,
                                "xmin": r(d[preds[0]].min()), "xmax": r(d[preds[0]].max())}})
    return {"title": f"Regresión lineal: {outcome}",
            "tables": [{"title": "Resumen del modelo", "columns": ["N", "R²", "R² ajustado", "F", "p (F)", "AIC"],
                        "rows": [[int(m.nobs), r(m.rsquared), r(m.rsquared_adj), r(m.fvalue), fp(m.f_pvalue), r(m.aic, 1)]]},
                       {"title": "Coeficientes", "columns": ["Término", "B", "EE", "t", "p", "IC95% inf", "IC95% sup"], "rows": rows}],
            "charts": charts,
            "summary": f"R² = {r(m.rsquared, 3)} (ajustado {r(m.rsquared_adj, 3)}), F = {r(m.fvalue, 2)}, p = {fp(m.f_pvalue)}, N = {int(m.nobs)}."}


def logreg(df, p, variables):
    outcome, preds = p.get("outcome"), p.get("predictors") or []
    d, formula = _design(df, outcome, preds, variables, binary_outcome=True)
    try:
        m = smf.logit(formula, data=d).fit(disp=0, maxiter=200)
    except Exception as e:  # perfect separation, singular matrix
        raise StatsError(f"El modelo no convergió: {e}")
    ci = m.conf_int()
    rows = [[_clean_term(t), r(m.params[t], 4), r(m.bse[t], 4), r(m.tvalues[t], 3), fp(m.pvalues[t]),
             r(np.exp(m.params[t])), f"{r(np.exp(ci.loc[t, 0]))} – {r(np.exp(ci.loc[t, 1]))}"] for t in m.params.index]
    or_chart = [{"category": _clean_term(t), "OR": r(np.exp(m.params[t])), "lo": r(np.exp(ci.loc[t, 0])), "hi": r(np.exp(ci.loc[t, 1]))}
                for t in m.params.index if t != "Intercept"]
    return {"title": f"Regresión logística: {outcome}",
            "tables": [{"title": "Resumen del modelo", "columns": ["N", "Eventos", "Pseudo R² (McFadden)", "AIC", "p (LR)"],
                        "rows": [[int(m.nobs), int(d[outcome].sum()), r(m.prsquared), r(m.aic, 1), fp(m.llr_pvalue)]]},
                       {"title": "Coeficientes (Odds Ratios)", "columns": ["Término", "B", "EE", "z", "p", "OR", "IC95% OR"], "rows": rows}],
            "charts": [{"type": "bar", "title": "Odds Ratios", "x": "category", "series": ["OR"], "data": or_chart, "meta": {"refline": 1}}],
            "summary": f"Pseudo R² = {r(m.prsquared, 3)}, p (razón de verosimilitud) = {fp(m.llr_pvalue)}, N = {int(m.nobs)}."}


def kaplan_meier(df, p):
    tv, ev, gv = p.get("time"), p.get("event"), p.get("group")
    t, e = num(df, tv), num(df, ev)
    g = cat(df, gv) if gv else pd.Series(["Todos"] * len(df), index=df.index)
    m = t.notna() & e.notna() & g.notna()
    t, e, g = t[m], e[m], g[m]
    if not set(e.unique()) <= {0, 1}:
        raise StatsError(f"La variable de evento '{ev}' debe codificarse 0 (censura) / 1 (evento).")
    levels = _levels(g)
    rows, curves = [], {}
    for lv in levels:
        mm = g == lv
        sf = SurvfuncRight(t[mm].to_numpy(), e[mm].to_numpy())
        med = sf.quantile(0.5)
        curves[lv] = list(zip(sf.surv_times, sf.surv_prob))
        rows.append([lv, int(mm.sum()), int(e[mm].sum()), r(med, 2) if med is not None and np.isfinite(med) else "No alcanzada",
                     r(100 * sf.surv_prob[-1], 1) if len(sf.surv_prob) else 100.0])
    times = sorted({0.0, *[float(x) for c in curves.values() for x, _ in c]})
    data, last = [], {lv: 1.0 for lv in levels}
    lookup = {lv: dict((float(x), float(s)) for x, s in c) for lv, c in curves.items()}
    for tt in times:
        pt: dict[str, Any] = {"t": r(tt, 2)}
        for lv in levels:
            if tt in lookup[lv]:
                last[lv] = lookup[lv][tt]
            pt[lv] = r(last[lv], 4)
        data.append(pt)
    tables = [{"title": "Resumen de supervivencia", "columns": ["Grupo", "N", "Eventos", "Mediana de supervivencia", "S(t) final %"], "rows": rows}]
    summary = f"{int(e.sum())} eventos en {len(t)} sujetos."
    if len(levels) > 1:
        chi, pv = survdiff(t.to_numpy(), e.to_numpy(), g.to_numpy())
        tables.append({"title": "Prueba de log-rank", "columns": ["χ²", "gl", "p"], "rows": [[r(chi), len(levels) - 1, fp(pv)]]})
        summary += f" Log-rank χ² = {r(chi, 2)}, p = {fp(pv)}."
    return {"title": f"Kaplan-Meier: {tv}" + (f" según {gv}" if gv else ""), "tables": tables,
            "charts": [{"type": "survival", "title": "Curva de supervivencia", "x": "t", "series": levels, "data": data}],
            "summary": summary}


def table1(df, p, variables):
    gv, vs = p.get("group"), p.get("vars") or []
    if not vs:
        raise StatsError("Selecciona variables para la Tabla 1.")
    g = cat(df, gv) if gv else None
    levels = _levels(g) if g is not None else []
    cols = ["Variable", f"Total (N={len(df)})"] + [f"{lv} (n={int((g == lv).sum())})" for lv in levels] + (["p"] if levels else [])
    rows = []
    for v in vs:
        if variables.get(v) == "numeric":
            x = num(df, v)
            row = [f"{v}, media ± DE", f"{r(x.mean(), 1)} ± {r(x.std(), 1)}"]
            pv = None
            if levels:
                grp = [x[g == lv].dropna() for lv in levels]
                row += [f"{r(s.mean(), 1)} ± {r(s.std(), 1)}" for s in grp]
                ok = [s for s in grp if len(s) > 1]
                if len(ok) >= 2:
                    pv = stats.ttest_ind(*ok, equal_var=False).pvalue if len(ok) == 2 else stats.f_oneway(*ok).pvalue
                row.append(fp(pv))
            rows.append(row)
        else:
            c = cat(df, v)
            pv = None
            if levels:
                mm = c.notna() & g.notna()
                ct = pd.crosstab(c[mm], g[mm])
                if ct.shape[0] > 1 and ct.shape[1] > 1:
                    pv = stats.chi2_contingency(ct)[1]
            rows.append([f"{v}, n (%)", ""] + [""] * len(levels) + ([fp(pv)] if levels else []))
            for lv in _levels(c):
                n = int((c == lv).sum())
                row = [f"   {lv}", f"{n} ({r(100 * n / c.notna().sum(), 1)}%)"]
                for gl in levels:
                    sub = c[g == gl]
                    k = int((sub == lv).sum())
                    row.append(f"{k} ({r(100 * k / max(sub.notna().sum(), 1), 1)}%)")
                if levels:
                    row.append("")
                rows.append(row)
    return {"title": "Tabla 1: características basales" + (f" según {gv}" if gv else ""),
            "tables": [{"title": "Tabla 1", "columns": cols, "rows": rows,
                        "note": "Continuas: t de Welch (2 grupos) o ANOVA; categóricas: χ² de Pearson."}],
            "charts": [], "summary": f"Tabla 1 con {len(vs)} variables" + (f" estratificada por {gv}." if gv else ".")}


TESTS = {
    "descriptives": descriptives, "frequencies": frequencies, "ttest": ttest, "paired_ttest": paired_ttest,
    "mannwhitney": mannwhitney, "chi2": chi2, "anova": anova, "correlation": correlation,
    "linreg": linreg, "logreg": logreg, "kaplan_meier": kaplan_meier, "table1": table1,
}
NEEDS_TYPES = {"linreg", "logreg", "table1"}

TEST_DOCS = """- descriptives: {"vars": [..]}
- frequencies: {"var": ".."}
- ttest (2 grupos independientes): {"outcome": numérica, "group": categórica 2 niveles}
- paired_ttest: {"var1": numérica, "var2": numérica}
- mannwhitney: {"outcome": numérica, "group": categórica 2 niveles}
- chi2: {"row": categórica, "col": categórica}  (incluye OR si 2x2)
- anova: {"outcome": numérica, "group": categórica}
- correlation: {"vars": [numéricas], "method": "pearson"|"spearman"}
- linreg: {"outcome": numérica, "predictors": [..]}
- logreg: {"outcome": binaria, "predictors": [..]}
- kaplan_meier: {"time": numérica, "event": 0/1, "group": categórica opcional}
- table1: {"group": categórica opcional, "vars": [..]}"""


def run(test: str, rows: list[dict], variables: list[dict], params: dict) -> dict:
    df = pd.DataFrame(rows)
    if df.empty:
        raise StatsError("La base de datos no tiene registros.")
    fn = TESTS.get(test)
    if not fn:
        raise StatsError(f"Prueba desconocida: {test}")
    types = {v["name"]: v["type"] for v in variables}
    res = fn(df, params, types) if test in NEEDS_TYPES else fn(df, params)
    return {"test": test, **res}
