FROM python:3.12-slim

# System deps for parsedmarc (libxml2, libxslt for XML parsing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    libmagic1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install parsedmarc. InfluxDB writes are handled by the influx_writer sidecar.
RUN pip install --no-cache-dir \
    "parsedmarc<9.0" \
    google-auth \
    google-auth-oauthlib \
    google-api-python-client

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
