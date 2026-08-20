FROM postgres:16-alpine
COPY migrate-n8n-to-neon.sh /usr/local/bin/migrate-n8n-to-neon
RUN chmod 0755 /usr/local/bin/migrate-n8n-to-neon
CMD ["/usr/local/bin/migrate-n8n-to-neon"]
