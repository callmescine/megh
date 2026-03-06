#!/bin/bash
set -e

echo "=============================="
echo " Megh - Setup"
echo "=============================="

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Error: Docker is required but not installed."; exit 1; }
command -v docker compose >/dev/null 2>&1 || { echo "Error: Docker Compose V2 is required."; exit 1; }

# Check config
if [ ! -f config.yaml ]; then
    echo "Error: config.yaml not found."
    echo "Copy config.example.yaml to config.yaml and fill in your values:"
    echo "  cp config.example.yaml config.yaml"
    exit 1
fi

echo "[1/4] Building agent container image..."
docker build -t megh-agent:latest ./containers/

echo "[2/4] Starting infrastructure services..."
docker compose up -d postgres redis
echo "Waiting for services to be healthy..."
sleep 5

echo "[3/4] Starting application services..."
docker compose up -d api proxy web nginx

echo "[4/4] Waiting for health checks..."
for i in {1..30}; do
    if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
        echo ""
        echo "=============================="
        echo " Platform is live!"
        echo " API:   http://localhost:3000"
        echo " Web:   http://localhost:3001"
        echo " Proxy: http://localhost:8787"
        echo "=============================="
        exit 0
    fi
    printf "."
    sleep 2
done

echo ""
echo "Warning: Health check timed out. Check logs with: docker compose logs"
exit 1
