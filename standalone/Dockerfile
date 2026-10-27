# The standalone radiarch viewer: OHIF 3.13.13 with radiarch's extensions and plan review mode, served by nginx with
# Orthanc's DICOMweb and radiarch's API behind the same origin (ADR 0018). Build from the viewer/ directory:
#   docker build -f standalone/Dockerfile -t radiarch-viewer viewer/
# Research use only; not for clinical use.

FROM node:24-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src/viewer
COPY . .
RUN scripts/build-ohif.sh /build && test -f /build/Viewers/platform/app/dist/index.html

FROM nginx:1.27.5-alpine
COPY --from=build /build/Viewers/platform/app/dist /usr/share/nginx/html
COPY standalone/app-config.js /usr/share/nginx/html/app-config.js
COPY standalone/default.conf.template /etc/nginx/templates/default.conf.template
ENV VIEWER_PORT=80 \
    ORTHANC_URL=http://orthanc:8042 \
    ORTHANC_AUTHORIZATION="" \
    RADIARCH_URL=http://api:8000 \
    RADIARCH_API_KEY=""
EXPOSE 80
