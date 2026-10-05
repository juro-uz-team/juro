FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git socat poppler-utils tesseract-ocr \
    tesseract-ocr-eng tesseract-ocr-rus tesseract-ocr-uzb tesseract-ocr-uzb-cyrl \
    clamav clamav-freshclam \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
CMD ["node", "scripts/local/runtime.mjs"]
