#!/bin/sh
# ERP 3D Print & Ontwerp — opstarten in de add-on (stap 8)
# Opties uit /data/options.json → omgevingsvariabelen (nooit in de databank).
set -e
export NODE_ENV=production
export PORT=3010
export DB_PATH=/data/erp.db

optie() {
  node -e "try{const o=JSON.parse(require('fs').readFileSync('/data/options.json','utf8'));const v=o[process.argv[1]];process.stdout.write(v==null?'':String(v))}catch{}" "$1"
}
if [ -f /data/options.json ]; then
  export GEMINI_API_KEY="$(optie gemini_api_key)"
  G="$(optie gemini_model)";  [ -n "$G" ] && export GEMINI_MODEL="$G"
  export SMTP_USER="$(optie smtp_user)"
  export SMTP_PASS="$(optie smtp_pass)"
  export SMTP_FROM="$(optie smtp_from)"
  H="$(optie smtp_host)";     [ -n "$H" ] && export SMTP_HOST="$H"
  P="$(optie smtp_port)";     [ -n "$P" ] && export SMTP_PORT="$P"
  T="$(optie tijdzone)";      [ -n "$T" ] && export TZ="$T"
fi
# Backup terugzetten: leg het bestand als "terugzetten.db" in de add-on-map
# (/addon_configs/<…>_erp_3d_print_ontwerp via Samba/SSH) en herstart de add-on.
# De huidige databank gaat eerst naar /data/backups.
if [ -f /config/terugzetten.db ]; then
  mkdir -p /data/backups
  [ -f /data/erp.db ] && mv /data/erp.db "/data/backups/erp-voor-terugzetten-$(date +%Y-%m-%d_%H%M%S).db"
  rm -f /data/erp.db-wal /data/erp.db-shm
  mv /config/terugzetten.db /data/erp.db
  echo "Backup teruggezet uit /config/terugzetten.db (vorige databank in /data/backups)."
fi

# Home Assistant via de Supervisor (SUPERVISOR_TOKEN wordt door HA gezet)
export HA_URL="http://supervisor/core"

echo "ERP 3D Print & Ontwerp: poort $PORT, databank $DB_PATH"
[ -n "$GEMINI_API_KEY" ] && echo "Gemini: ingesteld" || echo "Gemini: niet ingesteld"
[ -n "$SMTP_USER" ] && echo "Mail: $SMTP_USER via ${SMTP_HOST:-Gmail}" || echo "Mail: niet ingesteld"

cd /app/backend
exec node server.js
