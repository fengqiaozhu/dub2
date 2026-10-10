FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Point ffmpeg-static to system ffmpeg binary instead of downloading at install time
ENV FFMPEG_BIN=/usr/bin/ffmpeg

COPY package*.json ./
# Aligned with CI lifecycle script policy: disable arbitrary postinstall scripts
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

EXPOSE 13000

CMD ["npm", "start"]
