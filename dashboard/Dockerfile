# AgentOS Dashboard — Dockerfile
# Python 3.12 slim, psutil only, ~50MB image.
# Pattern lifted from nesquena/hermes-webui (multi-stage not needed at this size).
FROM python:3.12-slim

LABEL org.opencontainers.image.source="https://github.com/UncleBad/agentos"
LABEL org.opencontainers.image.description="AgentOS Dashboard — VPS metrics + 3-agent status + schedule view"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install psutil (the only non-stdlib dep)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY server.py ./
COPY static/ ./static/

# Run as non-root
RUN useradd --create-home --uid 1000 agentos
USER agentos

EXPOSE 8787

# Health check against our /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8787/api/health').read()" || exit 1

# Defaults: bind to all interfaces (Tailscale reaches it via 100.98.6.47).
# Override with --host 127.0.0.1 for local-only dev.
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8787"]
