# syntax=docker/dockerfile:1.7
# Build context: repository root (docker build -f server/Dockerfile .)

FROM --platform=$BUILDPLATFORM oven/bun:1.3 AS build
ARG TARGETARCH
ARG VERSION=""
ARG GOOGLE_CLIENT_ID=""
ARG GOOGLE_CLIENT_SECRET=""
WORKDIR /src/server
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile
COPY server/ ./
RUN if [ -n "$VERSION" ]; then bun -e "const p=await Bun.file('package.json').json();p.version=process.env.VERSION.replace(/^v/,'');await Bun.write('package.json',JSON.stringify(p,null,2))"; fi
RUN case "$TARGETARCH" in arm64) T=linux-arm64 ;; *) T=linux-x64 ;; esac && \
    GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" bun run scripts/build.ts $T && \
    mkdir -p /out && cp dist/opencctv-$T /out/opencctv

FROM debian:bookworm-slim AS tools
ARG TARGETARCH
ARG GO2RTC_VERSION=1.9.14
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /usr/local/bin/go2rtc "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${TARGETARCH}" && \
    chmod +x /usr/local/bin/go2rtc
RUN curl -fsSL -o /tmp/rclone.zip "https://downloads.rclone.org/rclone-current-linux-${TARGETARCH}.zip" && \
    unzip -j /tmp/rclone.zip '*/rclone' -d /usr/local/bin && chmod +x /usr/local/bin/rclone

FROM mwader/static-ffmpeg:9.0.2 AS ffmpeg

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
COPY --from=tools /usr/local/bin/go2rtc /usr/local/bin/rclone /usr/local/bin/
COPY --from=build /out/opencctv /usr/local/bin/opencctv
COPY demo/media/ /opt/opencctv/demo/
ENV OPENCCTV_DOCKER=1 \
    OPENCCTV_DATA=/data \
    OPENCCTV_PORT=8080 \
    OPENCCTV_DEMO_DIR=/opt/opencctv/demo \
    OPENCCTV_NO_DOWNLOAD=1
VOLUME ["/data"]
EXPOSE 8080/tcp 8554/tcp 8555/tcp 8555/udp 1935/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["/usr/local/bin/opencctv", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/opencctv"]
CMD ["serve"]
