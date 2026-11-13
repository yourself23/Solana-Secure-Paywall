#!/bin/bash
set -e

echo "=== Solana Anchor Smart Contract Deploy Script ==="

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

# Check for Solana CLI
if ! command -v solana &> /dev/null; then
    echo "Error: Solana CLI not found. Please install Solana CLI first."
    exit 1
fi

# Step 2: Navigate to contracts directory
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
    # Generate keypair with passphrase prompt (more secure)
    solana-keygen new --outfile "$KEYPAIR_PATH"
else
    echo "Existing program keypair found at $KEYPAIR_PATH"
fi

# Get program ID from keypair
PROGRAM_ID=$(solana address -k "$KEYPAIR_PATH")
echo "Program ID: $PROGRAM_ID"

# Step 3: Sync program ID in source code (recommended Anchor approach)
echo "Syncing program ID in source code..."
anchor keys sync

# Step 4: Build Anchor program
echo "Building Anchor BPF program..."
anchor build

# Step 5: Deploy to Solana network
# Default to devnet for safety; override with SOLANA_NETWORK env var
NETWORK="${SOLANA_NETWORK:-devnet}"
echo "Deploying program to Solana $NETWORK..."
anchor deploy --program-keypair "$KEYPAIR_PATH" --provider.cluster "$NETWORK"

echo "=== Anchor Smart Contract Deploy Completed Successfully ==="
echo "Program ID: $PROGRAM_ID"
echo "Network: $NETWORK"
echo ""
echo "Next steps:"
echo "1. Update your frontend with the new program ID: $PROGRAM_ID"
echo "2. Initialize the paywall account with: anchor run initialize --price <amount_in_lamports>"