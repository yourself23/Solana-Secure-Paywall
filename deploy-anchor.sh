#!/bin/bash
set -e

echo "=== Solana Anchor Smart Contract Auto-Deploy Script ==="

# Step 1: Check dependencies
if ! command -v anchor &> /dev/null; then
    echo "Anchor CLI not found. Installing Anchor..."
    cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked || {
        echo "Error: Failed to install Anchor CLI. Please ensure Rust and cargo are installed."
        exit 1
    }
else
    echo "Anchor CLI is installed."
fi

# Step 2: Navigate to contracts directory or configure target
CONTRACT_DIR="./contracts/botwall"
if [ ! -d "$CONTRACT_DIR" ]; then
    echo "Error: Contract directory $CONTRACT_DIR not found."
    exit 1
fi

cd "$CONTRACT_DIR"

echo "Creating target/deploy directory..."
mkdir -p target/deploy

KEYPAIR_PATH="target/deploy/botwall-keypair.json"

if [ ! -f "$KEYPAIR_PATH" ]; then
    echo "Generating new Solana keypair for program..."
    solana-keygen new --outfile "$KEYPAIR_PATH" --no-passphrase
else
    echo "Existing program keypair found at $KEYPAIR_PATH"
fi

# Get program ID
PROGRAM_ID=$(solana address -k "$KEYPAIR_PATH")
echo "Generated Program ID: $PROGRAM_ID"

# Update declare_id! in src/lib.rs
LIB_RS="src/lib.rs"
if [ -f "$LIB_RS" ]; then
    echo "Updating declare_id! in $LIB_RS with $PROGRAM_ID..."
    # Replace declare_id! line
    sed -i.bak 's/declare_id!(".*/declare_id!("'"$PROGRAM_ID"'");/' "$LIB_RS"
    rm -f src/lib.rs.bak
fi

# Step 3: Build Anchor program
echo "Building Anchor BPF program..."
anchor build

# Step 4: Deploy to Solana network
echo "Deploying program to Solana mainnet..."
anchor deploy --program-keypair "$KEYPAIR_PATH"

echo "=== Anchor Smart Contract Auto-Deploy Completed Successfully ==="
