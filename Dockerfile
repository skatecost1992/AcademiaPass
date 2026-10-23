# Imagen de AcademiaPass (API + version web en un solo servicio) para Railway (railway.json), la maquina virtual de
# Oracle Cloud (deploy/oracle) o cualquier servicio con Docker. Base externa (Neon): DATABASE_URL. Puerto: PORT.

# 1. Version web de la app (Expo) exportada a archivos estaticos
FROM node:24-slim AS web
WORKDIR /app/app-android
COPY app-android/package.json app-android/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY app-android/ ./
RUN npx expo export --platform web --output-dir /app/web

# 2. API (Node 24 ejecuta TypeScript directamente)
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=web /app/web ./public
EXPOSE 8080
CMD ["node", "src/server.ts"]
