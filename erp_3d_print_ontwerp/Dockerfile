# ERP 3D Print & Ontwerp - add-on (stap 8)
# Bouwt in Home Assistant uit de map erp_3d_print_ontwerp/ (build_deploy.bat kopieert de
# backend en de gebouwde frontend hierin).
FROM node:22-alpine

# better-sqlite3 (native) bouwen indien nodig + Chromium voor de PDF's
# (offerte, werkbon, pakbon via puppeteer-core) + tijdzones
RUN apk add --no-cache python3 make g++ \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto tzdata

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production

WORKDIR /app
COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY backend/ ./backend/
COPY frontend/dist/ ./frontend/dist/
COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 3010
CMD ["/run.sh"]
