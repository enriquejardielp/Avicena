import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine import dispatch_test  # noqa: E402


class TestPythonStatsEngineGolden(unittest.TestCase):
    def setUp(self) -> None:
        self.variables = [
            {"name": "grupo", "label": "Grupo", "type": "categorical", "levels": ["A", "B"]},
            {"name": "valor", "label": "Valor", "type": "numeric", "levels": []},
            {"name": "x", "label": "X", "type": "numeric", "levels": []},
            {"name": "y", "label": "Y", "type": "numeric", "levels": []},
            {"name": "tiempo", "label": "Tiempo", "type": "numeric", "levels": []},
            {"name": "evento", "label": "Evento", "type": "binary", "levels": ["0", "1"]},
            {"name": "conteo", "label": "Conteo", "type": "numeric", "levels": []},
        ]
        self.rows = [
            {"grupo": "A", "valor": 10, "x": 1, "y": 4, "tiempo": 2, "evento": 0, "conteo": 1},
            {"grupo": "A", "valor": 12, "x": 2, "y": 9, "tiempo": 4, "evento": 0, "conteo": 1},
            {"grupo": "A", "valor": 14, "x": 3, "y": 10, "tiempo": 6, "evento": 0, "conteo": 1},
            {"grupo": "A", "valor": 16, "x": 4, "y": 15, "tiempo": 8, "evento": 0, "conteo": 2},
            {"grupo": "A", "valor": 18, "x": 5, "y": 16, "tiempo": 10, "evento": 0, "conteo": 2},
            {"grupo": "B", "valor": 20, "x": 6, "y": 21, "tiempo": 3, "evento": 1, "conteo": 4},
            {"grupo": "B", "valor": 22, "x": 7, "y": 23, "tiempo": 5, "evento": 1, "conteo": 5},
            {"grupo": "B", "valor": 24, "x": 8, "y": 27, "tiempo": 7, "evento": 1, "conteo": 5},
            {"grupo": "B", "valor": 26, "x": 9, "y": 28, "tiempo": 9, "evento": 1, "conteo": 6},
            {"grupo": "B", "valor": 28, "x": 10, "y": 33, "tiempo": 11, "evento": 1, "conteo": 7},
        ]

    def test_ttest_and_mannwhitney(self) -> None:
        res_t = dispatch_test(
            {"specVersion": "1.0", "test": "ttest", "params": {"outcome": "valor", "group": "grupo"}, "options": {"seed": 42}},
            self.variables,
            self.rows,
        )
        t_val = float(res_t["result"]["tables"][1]["rows"][0][0])
        self.assertAlmostEqual(t_val, -5.0, places=4)
        self.assertTrue(any(c["package"] == "scipy" for c in res_t["citations"]))

        res_mw = dispatch_test(
            {"specVersion": "1.0", "test": "mannwhitney", "params": {"outcome": "valor", "group": "grupo"}, "options": {"seed": 42}},
            self.variables,
            self.rows,
        )
        u_val = float(res_mw["result"]["tables"][0]["rows"][0][5])
        self.assertAlmostEqual(u_val, 0.0, places=4)

    def test_linreg_logreg_poisson_km_cox_roc(self) -> None:
        ols = dispatch_test(
            {"specVersion": "1.0", "test": "linreg", "params": {"outcome": "y", "predictors": ["x"]}, "options": {"seed": 42}},
            self.variables,
            self.rows,
        )
        self.assertGreater(float(ols["result"]["tables"][0]["rows"][0][1]), 0.96)
        self.assertTrue(any(c["package"] == "statsmodels" for c in ols["citations"]))

        pois = dispatch_test(
            {"specVersion": "1.0", "test": "poisson_reg", "params": {"outcome": "conteo", "predictors": ["x"]}, "options": {"seed": 42}},
            self.variables,
            self.rows,
        )
        self.assertGreater(float(pois["result"]["tables"][1]["rows"][1][5]), 1.15)

        km = dispatch_test(
            {"specVersion": "1.0", "test": "kaplan_meier", "params": {"time": "tiempo", "event": "evento"}, "options": {"seed": 42}},
            self.variables,
            self.rows,
        )
        self.assertEqual(int(km["result"]["tables"][0]["rows"][0][2]), 5)
        self.assertTrue(any(c["package"] == "lifelines" for c in km["citations"]))

        cox_rows = [
            {"tiempo": 2, "evento": 1, "valor": 76},
            {"tiempo": 3, "evento": 1, "valor": 72},
            {"tiempo": 4, "evento": 1, "valor": 68},
            {"tiempo": 5, "evento": 1, "valor": 64},
            {"tiempo": 6, "evento": 1, "valor": 60},
            {"tiempo": 8, "evento": 0, "valor": 50},
            {"tiempo": 9, "evento": 0, "valor": 48},
            {"tiempo": 10, "evento": 0, "valor": 45},
            {"tiempo": 11, "evento": 0, "valor": 42},
            {"tiempo": 12, "evento": 0, "valor": 38},
        ]
        cox = dispatch_test(
            {"specVersion": "1.0", "test": "cox_ph", "params": {"time": "tiempo", "event": "evento", "predictors": ["valor"]}, "options": {"seed": 42}},
            self.variables,
            cox_rows,
        )
        self.assertGreater(float(cox["result"]["tables"][0]["rows"][0][2]), 0.85)
        self.assertGreater(float(cox["result"]["tables"][1]["rows"][0][5]), 1.0)

        roc = dispatch_test(
            {"specVersion": "1.0", "test": "roc_auc", "params": {"marker": "valor", "outcome": "evento"}, "options": {"seed": 42}},
            self.variables,
            self.rows,
        )
        self.assertAlmostEqual(float(roc["result"]["tables"][0]["rows"][0][3]), 1.0, places=4)
        self.assertTrue(any(c["package"] == "scikit-learn" for c in roc["citations"]))

    def test_advanced_tests_coverage(self) -> None:
        ext_vars = self.variables + [
            {"name": "v1", "label": "V1", "type": "numeric", "levels": []},
            {"name": "v2", "label": "V2", "type": "numeric", "levels": []},
            {"name": "v3", "label": "V3", "type": "numeric", "levels": []},
        ]
        ext_rows = [
            {**r, "v1": float(r["x"]) + (50.0 if i == 9 else 0.0), "v2": float(r["x"]) * 1.1 + 1.0, "v3": float(r["x"]) * 1.3 + 2.0}
            for i, r in enumerate(self.rows)
        ]

        kendall = dispatch_test(
            {"specVersion": "1.0", "test": "correlation", "params": {"vars": ["x", "y"], "method": "kendall"}, "options": {"seed": 42}},
            ext_vars,
            ext_rows,
        )
        self.assertIn("kendall", kendall["result"]["summary"].lower())

        out = dispatch_test(
            {"specVersion": "1.0", "test": "outlier_detection", "params": {"vars": ["v1"], "z_threshold": 2.5}, "options": {"seed": 42}},
            ext_vars,
            ext_rows,
        )
        self.assertGreaterEqual(int(out["result"]["tables"][0]["rows"][0][3]), 1)

        miss = dispatch_test(
            {"specVersion": "1.0", "test": "missing_analysis", "params": {"vars": ["x", "y"]}, "options": {"seed": 42}},
            ext_vars,
            ext_rows,
        )
        self.assertEqual(len(miss["result"]["tables"][0]["rows"]), 2)

        rm = dispatch_test(
            {"specVersion": "1.0", "test": "rm_anova", "params": {"vars": ["v1", "v2", "v3"]}, "options": {"seed": 42}},
            ext_vars,
            ext_rows,
        )
        self.assertEqual(len(rm["result"]["tables"]), 3)

        icc = dispatch_test(
            {"specVersion": "1.0", "test": "icc", "params": {"vars": ["v2", "v3"], "icc_type": "agreement"}, "options": {"seed": 42}},
            ext_vars,
            ext_rows,
        )
        self.assertEqual(len(icc["result"]["tables"][0]["rows"]), 4)

        inc = dispatch_test(
            {"specVersion": "1.0", "test": "incidence_prevalence", "params": {"outcome": "evento", "group": "grupo", "time": "tiempo"}, "options": {"seed": 42}},
            ext_vars,
            ext_rows,
        )
        self.assertEqual(len(inc["result"]["tables"][0]["rows"]), 2)

        mt = dispatch_test(
            {"specVersion": "1.0", "test": "multiple_testing", "params": {"mode": "pvalues", "pvalues": [0.002, 0.03, 0.4], "labels": ["H1", "H2", "H3"], "method": "fdr_bh"}, "options": {"seed": 42}},
            ext_vars,
            ext_rows,
        )
        self.assertEqual(len(mt["result"]["tables"][0]["rows"]), 3)

        pwr = dispatch_test(
            {"specVersion": "1.0", "test": "sample_size", "params": {"calc_mode": "power", "design": "two_proportions", "n1": 80, "p1": 0.3, "p2": 0.15, "alpha": 0.05}, "options": {"seed": 42}},
            ext_vars,
            ext_rows,
        )
        self.assertIn("potencia", pwr["result"]["summary"].lower())

        ts_rows = [{"x": i + 1, "y": 20.0 + i * 1.5 + (2.0 if i % 2 == 0 else -2.0)} for i in range(16)]
        trend = dispatch_test(
            {"specVersion": "1.0", "test": "ts_trend_seasonal", "params": {"outcome": "y", "time": "x", "period": 4}, "options": {"seed": 42}},
            self.variables,
            ts_rows,
        )
        self.assertEqual(trend["result"]["charts"][0]["type"], "line")

        arima = dispatch_test(
            {"specVersion": "1.0", "test": "ts_arima", "params": {"outcome": "y", "time": "x", "p": 1, "d": 1, "q": 0, "forecast_steps": 3, "auto_order": True}, "options": {"seed": 42}},
            self.variables,
            ts_rows,
        )
        self.assertEqual(len(arima["result"]["tables"][2]["rows"]), 3)


if __name__ == "__main__":
    unittest.main()
