#!/bin/sh
# This script creates the necessary Cloudflare resources for the project.

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Creating KV namespace..."
npx wrangler kv namespace create "INVOICES_KV"

echo "\n--------------------------------------------------\n"

echo "Creating R2 bucket..."
npx wrangler r2 bucket create "auto-invoice"

echo "\n--------------------------------------------------\n"
echo "✅ Resources created successfully."
echo "➡️ Next steps: Please copy the 'id' of the KV namespace and the 'bucket_name' of the R2 bucket into your wrangler.json file."
