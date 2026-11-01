ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-uno python3-olefile libreoffice-writer libreoffice-calc libreoffice-impress \
    fonts-liberation fonts-dejavu-core fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
COPY render.py /opt/juro/render.py
ENV HOME=/tmp SAL_USE_VCLPLUGIN=svp PYTHONDONTWRITEBYTECODE=1
USER 65534:65534
ENTRYPOINT ["/usr/bin/python3", "/opt/juro/render.py"]
