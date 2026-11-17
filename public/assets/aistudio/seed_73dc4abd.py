"""Idempotent demo seed: two public demo projects (read-only for non-admins).
Run: cd /app/backend && python seed.py"""

import asyncio

import numpy as np
import pandas as pd

from lib.dataset_utils import frame_to_rows, infer_variables
from lib.db import db, ensure_indexes
from models.core import Dataset, Form, FormField, Project


def cardiomed(rng) -> pd.DataFrame:
    n = 240
    trat = rng.choice(["Placebo", "Fármaco A"], n)
    sexo = rng.choice(["Mujer", "Hombre"], n)
    edad = rng.normal(62, 10, n).round(0)
    diab = (rng.random(n) < 0.32).astype(int)
    imc = rng.normal(28, 4, n).round(1)
    pas_basal = rng.normal(148, 14, n).round(0)
    efecto = np.where(trat == "Fármaco A", -14, -4)
    pas_12s = (pas_basal + efecto + rng.normal(0, 9, n)).round(0)
    colesterol = rng.normal(210, 35, n).round(0)
    tabaco = rng.choice(["Nunca", "Exfumador", "Actual"], n, p=[0.45, 0.35, 0.2])
    logit = -1.4 + 0.05 * (edad - 60) + 1.0 * diab + 0.03 * (pas_12s - 140) - 0.7 * (trat == "Fármaco A")
    evento = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    pas_12s[rng.choice(n, 6, replace=False)] = np.nan
    return pd.DataFrame({"id_paciente": [f"CM-{i:03d}" for i in range(1, n + 1)], "tratamiento": trat, "sexo": sexo,
                         "edad": edad, "imc": imc, "diabetes": diab, "tabaquismo": tabaco, "pas_basal": pas_basal,
                         "pas_12s": pas_12s, "colesterol": colesterol, "evento_cv": evento})


def oncosurv(rng) -> pd.DataFrame:
    n = 160
    brazo = rng.choice(["Estándar", "Inmunoterapia"], n)
    estadio = rng.choice(["II", "III", "IV"], n, p=[0.3, 0.4, 0.3])
    edad = rng.normal(58, 11, n).round(0)
    scale = np.where(brazo == "Inmunoterapia", 38, 16) * np.select([estadio == "II", estadio == "III"], [1.4, 1.0], 0.6)
    t_real = rng.exponential(scale)
    censura = rng.uniform(6, 48, n)
    tiempo = np.minimum(t_real, censura).round(1)
    muerte = (t_real <= censura).astype(int)
    ecog = rng.choice([0, 1, 2], n, p=[0.4, 0.4, 0.2])
    return pd.DataFrame({"id_paciente": [f"OS-{i:03d}" for i in range(1, n + 1)], "brazo": brazo, "estadio": estadio,
                         "edad": edad, "ecog": ecog, "tiempo_meses": tiempo, "muerte": muerte})


async def add_project(name, desc, datasets, forms=()):
    if await db.projects.find_one({"name": name, "demo": True}):
        print("exists:", name)
        return
    p = Project(name=name, description=desc, owner_id="system", demo=True)
    await db.projects.insert_one(p.model_dump(exclude={"dataset_count", "form_count", "record_count", "can_edit"}))
    for ds_name, df in datasets:
        rows = frame_to_rows(df)
        ds = Dataset(project_id=p.id, name=ds_name, source="demo", variables=infer_variables(pd.DataFrame(rows)), n_rows=len(rows))
        await db.datasets.insert_one(ds.model_dump())
        await db.rows.insert_many([{"id": f"{ds.id}-{i}", "dataset_id": ds.id, "seq": i, "data": r, "created_by": "system"} for i, r in enumerate(rows)])
    for fname, fdesc, fields in forms:
        variables = [{"name": f.name, "label": f.label, "type": {"number": "numeric", "yesno": "binary", "select": "categorical",
                      "radio": "categorical", "date": "date"}.get(f.type, "text"), "levels": []} for f in fields]
        ds = Dataset(project_id=p.id, name=f"Formulario · {fname}", source="form", variables=variables)
        form = Form(project_id=p.id, dataset_id=ds.id, name=fname, description=fdesc, fields=fields)
        ds.form_id = form.id
        await db.datasets.insert_one(ds.model_dump())
        await db.forms.insert_one(form.model_dump(exclude={"record_count"}))
    print("seeded:", name)


async def main():
    await ensure_indexes()
    rng = np.random.default_rng(2026)
    crf = [
        FormField(name="id_paciente", label="ID del paciente", type="text", required=True),
        FormField(name="fecha_visita", label="Fecha de la visita", type="date", required=True),
        FormField(name="sexo", label="Sexo", type="radio", choices=["Mujer", "Hombre"], required=True),
        FormField(name="edad", label="Edad", type="number", min=18, max=110, unit="años", required=True),
        FormField(name="pas", label="Presión sistólica", type="number", min=60, max=250, unit="mmHg"),
        FormField(name="diabetes", label="¿Diabetes mellitus?", type="yesno"),
        FormField(name="tabaquismo", label="Tabaquismo", type="select", choices=["Nunca", "Exfumador", "Actual"]),
        FormField(name="sintomas", label="Síntomas", type="checkbox", choices=["Disnea", "Dolor torácico", "Palpitaciones", "Edemas"]),
        FormField(name="notas", label="Observaciones clínicas", type="textarea"),
    ]
    await add_project("Ensayo Clínico CARDIOMED-2026",
                      "Ensayo aleatorizado de un antihipertensivo frente a placebo en 240 pacientes. Demo de solo lectura.",
                      [("CARDIOMED-2026 · Cohorte basal y 12 semanas", cardiomed(rng))],
                      [("CRF Visita basal", "Cuaderno de recogida de datos de la visita basal", crf)])
    await add_project("Estudio Oncológico ONCO-SURV",
                      "Supervivencia global con inmunoterapia vs tratamiento estándar (Kaplan-Meier). Demo de solo lectura.",
                      [("ONCO-SURV · Supervivencia", oncosurv(rng))])


if __name__ == "__main__":
    asyncio.run(main())
