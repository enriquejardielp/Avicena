# Multi-runtime container for Avicena: Node.js 22 (API + SPA) + isolated Python 3.11 scientific worker
FROM node:22-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create isolated Python virtualenv for validated statistical libraries
RUN python3 -m venv /opt/stats-venv \
  && /opt/stats-venv/bin/pip install --no-cache-dir --upgrade pip

COPY stats-worker/requirements.txt ./stats-worker/requirements.txt
RUN /opt/stats-venv/bin/pip install --no-cache-dir -r ./stats-worker/requirements.txt

# Install Node dependencies and build Vite frontend
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Drop root privileges
RUN groupadd --system appgroup && useradd --system --gid appgroup --home /tmp appuser \
  && chown -R appuser:appgroup /app /opt/stats-venv

USER appuser

ENV NODE_ENV=production
ENV PORT=3000
ENV STATS_PYTHON_BIN=/opt/stats-venv/bin/python

EXPOSE 3000
CMD ["npm", "start"]
