# Avicena · Bioestadística clínica con IA

Plataforma de investigación clínica en español que integra:
- **Captura electrónica de datos (CRF estilo REDCap)** con validación de rangos clínicos y sincronización automática.
- **Motor bioestadístico exacto (12 pruebas)**: Tabla 1, descriptivos + Shapiro-Wilk, frecuencias, t de Student/Welch + Levene, t pareada/Wilcoxon, U de Mann-Whitney, χ²/Fisher/OR, ANOVA + Tukey HSD, correlación Pearson/Spearman, regresión lineal, regresión logística y supervivencia Kaplan-Meier + Log-Rank.
- **Copiloto bioestadístico con Gemini AI** en streaming SSE.
- **Importación y exportación CSV / Excel (.xlsx/.xls)**.

---

## Desarrollo local

```bash
npm install
cp .env.example .env
# Añade tu GEMINI_API_KEY en .env
npm run dev
```

Abre `http://localhost:3000`.

---

## Subir a GitHub y desplegar en Render

### 1. Subir el código a GitHub

```bash
git init
git add .
git commit -m "Inicializar Avicena"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/avicena.git
git push -u origin main
```

### 2. Desplegar en Render

Tienes dos formas en [dashboard.render.com](https://dashboard.render.com):

**Opción A · Con Blueprint (`render.yaml` incluido)**
1. En Render, pulsa **New + → Blueprint**.
2. Conecta tu repositorio de GitHub `avicena`.
3. Render detectará automáticamente `render.yaml` (Node 22, `npm install && npm run build`, `npm start` y health check `/api/health`).
4. Introduce tu variable secreta `GEMINI_API_KEY` y pulsa **Apply**.

**Opción B · Web Service manual**
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Health Check Path**: `/api/health`
- **Environment Variables**:
  - `NODE_ENV=production`
  - `NODE_VERSION=22.18.0`
  - `GEMINI_API_KEY=tu_clave_de_gemini`
  - *(Opcional con Render Disk)* `AVICENA_DATA_FILE=/var/data/avicena.json`

> Nota: En el plan gratuito sin disco persistente, los cambios en la base de datos de demostración se reinician si el contenedor se reconstruye; los 3 estudios clínicos iniciales (`CARDIOMED-2026`, `ONCO-SURV`, `COVID-Longitud`) se siembran automáticamente en el arranque.
