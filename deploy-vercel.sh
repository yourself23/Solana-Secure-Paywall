#!/bin/bash
set -e

echo "=== Secure Vercel Deployment Script ==="

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "Vercel CLI not found. Installing Vercel CLI..."
    npm install -g vercel
fi

# Ensure user is logged in to Vercel
echo "Verifying Vercel authentication..."
vercel whoami || {
    echo "Please log in to Vercel using 'vercel login' first."
    exit 1
}

# Environment variables that should be set in Vercel dashboard
# These should be configured via Vercel UI or CLI with actual secret values
REQUIRED_SECRETS=(
    "TREASURY_ADDRESS"
    "PAYMENT_AMOUNT_SOL"
    "API_CALLS_PER_PAYMENT"
    "PAYOUT_INTERVAL_MINUTES"
    "API_AUTH_SECRET"
    "UPSTASH_REDIS_REST_URL"
    "UPSTASH_REDIS_REST_TOKEN"
)

OPTIONAL_SECRETS=(
    "VITE_TREASURY_ADDRESS"
    "VITE_SOLANA_RPC_URL"
    "VITE_PAYMENT_AMOUNT_SOL"
    "VITE_API_CALLS_PER_PAYMENT"
    "VITE_ENABLE_HONEYPOT"
)

echo "Required environment variables for production:"
for secret in "${REQUIRED_SECRETS[@]}"; do
    echo "  - $secret"
done

echo ""
echo "Optional environment variables:"
for secret in "${OPTIONAL_SECRETS[@]}"; do
    echo "  - $secret"
done

echo ""
echo "IMPORTANT: Set these secrets in Vercel Dashboard:"
echo "  https://vercel.com/dashboard -> Project -> Settings -> Environment Variables"
echo ""
echo "Or use Vercel CLI (values will be prompted securely):"
for secret in "${REQUIRED_SECRETS[@]}"; do
    echo "  vercel env add $secret production"
done

# Check if .env.production exists for automated deployment
if [ -f ".env.production" ]; then
    echo ""
    echo "Found .env.production file. Reading secrets..."
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ ]] || [ -z "$key" ] && continue
        
        # Clean key name
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | xargs)
        
        # Remove quotes if present
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        
        if [ -n "$value" ] && [ "$value" != "YOUR_SECRET_VALUE" ] && [ "$value" != "MY_"* ]; then
            echo "Setting $key on Vercel..."
            echo "$value" | vercel env add "$key" production
        else
            echo "Skipping $key (placeholder value)"
        fi
    done < .env.production
else
    echo ""
    echo "No .env.production found. Please set environment variables manually in Vercel Dashboard."
fi

echo ""
echo "Deploying application to Vercel production..."
vercel --prod --confirm

echo ""
echo "=== Vercel Deployment Completed Successfully ==="
echo "Verify environment variables at: https://vercel.com/dashboard -> Project -> Settings -> Environment Variables"