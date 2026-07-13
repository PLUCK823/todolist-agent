FROM python:3.12-slim

WORKDIR /app

# Install uv for fast dependency resolution
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency manifests first for better layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies (without dev)
RUN uv sync --frozen --no-dev

# Copy application source
COPY app/ ./app/
COPY tests/ ./tests/

# Expose the FastAPI port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD uv run python -c "import httpx; httpx.get('http://localhost:8000/api/agent/health').raise_for_status()"

# Run the server
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
