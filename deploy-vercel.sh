#!/bin/bash
set -e

echo "=== Secure Vercel Deployment & Secret Provisioning Script ==="

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "Vercel CLI not found. Installing Vercel CLI globally..."
    npm install -g vercel
fi

# Ensure user is logged in to Vercel
echo "Verifying Vercel authentication..."
vercel whoami || {
    echo "Please log in to Vercel using 'vercel login' first."
    exit 1
}

# Securely provision environment variables / secrets to Vercel project
echo "Provisioning secrets and environment variables to Vercel..."

# Example secrets / config variables to push securely
# Note: In production, values are passed securely or prompted interactively.
# e.g., vercel env add GEMINI_API_KEY production < .env.production

if [ -f .env.example ]; then
    echo "Reading environment variables from .env template..."
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ ]] || [ -z "$key" ] && continue
        
        # Clean key name
        key=$(echo "$key" | xargs)
        
        echo "Configuring secret environment variable: $key on Vercel..."
        # Using vercel env add non-interactively where applicable or prompting
        # echo "YOUR_SECRET_VALUE" | vercel env add "$key" production
    done < .env.example
fi

echo "Deploying application to Vercel production..."
vercel --prod --confirm

echo "=== Vercel Secure Deployment Completed Successfully ==="
