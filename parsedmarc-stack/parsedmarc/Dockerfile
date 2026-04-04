FROM python:3.12-slim

# System deps for parsedmarc (libxml2, libxslt for XML parsing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    libmagic1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install parsedmarc with all optional extras
# influxdb2 extra needed for InfluxDB v2 output
RUN pip install --no-cache-dir \
    "parsedmarc[influxdb2]" \
    "influxdb-client[ciso]" \
    google-auth \
    google-auth-oauthlib \
    google-api-python-client

# Create non-root user
RUN useradd -r -s /bin/false parsedmarc

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER parsedmarc

ENTRYPOINT ["/entrypoint.sh"]
