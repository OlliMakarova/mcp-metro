#!/bin/bash

c='\033[0;35m'
y='\033[0;33m'
c0='\033[0;0m'
g='\033[0;32m'
set -e

# Parse arguments
NODE_ENV="development"
if [[ "$1" == "-p" || "$1" == "--prod" ]]; then
  NODE_ENV="production"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"  # Parent directory (project root)

# Load environment variables from .env if exists
if [ -f "$PROJECT_ROOT/.env" ]; then
  source "$PROJECT_ROOT/.env"
fi

# Get SERVICE_NAME from environment variable or package.json
if [ -n "$SERVICE_NAME" ]; then
  # Use environment variable
  SERVICE_NAME="$SERVICE_NAME"
else
  # Read from package.json
  SERVICE_NAME=`cat "$PROJECT_ROOT/package.json" | grep name | head -1 | awk -F: '{ print $2 }' | sed 's/[\",]//g' | tr -d '[[:space:]]'`
fi
if [ -z "$SERVICE_INSTANCE" ]
then
  SERVICE="${SERVICE_NAME}"
else
  SERVICE="${SERVICE_NAME}--${SERVICE_INSTANCE}"
fi

echo -e "$g========================================$c0"
echo -e "$g**** REGISTER SERVICE $y${SERVICE}$g ****$c0"
echo -e "$g========================================$c0"

# Checking if the service exists in PM2
if pm2 list | grep -q "$SERVICE"; then
  echo -e "${g}An existing process was found $y${SERVICE}$g. Deleting..."
  pm2 delete $SERVICE
fi

NODE_ENV=$NODE_ENV pm2 startOrRestart "$PROJECT_ROOT/deploy/pm2.config.js"
pm2 save
