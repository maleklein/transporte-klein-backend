# Imagen del backend de Transporte Klein para Railway.
# Debian slim y no Alpine: bcrypt trae binarios precompilados para glibc;
# en Alpine (musl) habría que compilarlo con python y build-base.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Primero solo las dependencias, así Docker reutiliza esta capa si no cambian.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY src ./src
# scripts/ es del usuario node: sembrar-localidades.js guarda ahí lo que baja de georef.
COPY --chown=node:node scripts ./scripts
COPY script_tablas.sql ./
COPY migrations ./migrations

# Railway inyecta PORT; index.js ya lo lee (en local queda 3000).
EXPOSE 3000
USER node
CMD ["node", "index.js"]
