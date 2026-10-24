FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
ENV PORT=4000 DB_PATH=/data/gulasadar.db
VOLUME /data
EXPOSE 4000
CMD ["bun", "src/server.js"]
