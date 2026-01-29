#!/bin/bash

# Scope Analytics - Quick Start

echo "[Info] Starting setup..."

# 1. Dependencies
if [ ! -d "node_modules" ]; then
    echo "[Setup] Installing dependencies..."
    pnpm install
else
    echo "[Setup] Dependencies already installed."
fi

# 2. Environment
if [ ! -f ".env" ]; then
    echo "[Setup] Creating .env from template..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        echo "[Warning] No .env.example found. Creating minimal configuration."
        cat > .env << EOF
CITREA_RPC_URL=https://rpc.mainnet.citrea.xyz
CITREA_CHAIN_ID=4114
CITREA_CONTRACT_ADDRESS=0x274602a953847d807231d2370072F5f4E4594B44
CITREA_DATABASE_FILE=citrea_cache.db
MONAD_DATABASE_FILE=monad_cache.db
BATCH_SIZE=1000
MAX_RETRIES=3
API_PORT=3000
API_HOST=localhost
EOF
    fi
fi

# 3. Launch
echo "[Info] Setup complete. Launching application..."
echo ""
pnpm start
