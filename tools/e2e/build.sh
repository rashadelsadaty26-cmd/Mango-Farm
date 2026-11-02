#!/bin/bash
# Bundles the REAL App.tsx with esbuild; only Firebase (in-memory stubs that record every write) and the lucide icons are stubbed.
set -e
cd "$(dirname "$0")"
node make-css.cjs
npx esbuild e2e-main.tsx --bundle --format=iife --outfile=app.bundle.js --jsx=automatic --log-level=error \
  --alias:firebase/app=./stubs/firebase-app.ts --alias:firebase/auth=./stubs/firebase-auth.ts --alias:firebase/firestore=./stubs/firebase-firestore.ts \
  --alias:lucide-react=./stubs/lucide-react.tsx \
  '--define:import.meta.env={"BASE_URL":"/","VITE_APP_ID":"e2e-app"}' --define:process.env.NODE_ENV=\"development\"
echo built
