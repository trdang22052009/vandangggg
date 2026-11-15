#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Chua tim thay Node.js. Hay cai Node.js LTS tai https://nodejs.org"
  read -r -p "Nhan Enter de thoat..."
  exit 1
fi
[ -d node_modules ] || npm install
[ -f .env ] || cp .env.example .env
open "http://localhost:3000/admin"
npm start
