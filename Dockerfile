# Imagen de AcademiaPass (API + version web en un solo servicio) para Render, Railway (railway.json), la maquina
# virtual de Oracle Cloud (deploy/oracle) o cualquier servicio con Docker. Base externa (Neon): DATABASE_URL. Puerto: PORT.
#
# La version web viene ya compilada en backend/public: el codigo de las apps no se sube al repositorio. Para
# actualizarla, en el PC: cd app-android && npm run build:web, y haz commit de backend/public.

# API (Node 24 ejecuta TypeScript directamente) y version web
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
EXPOSE 8080
CMD ["node", "src/server.ts"]
