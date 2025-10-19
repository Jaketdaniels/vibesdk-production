#!/bin/bash
# Anti-Pattern Scan Script
# Validates code against project quality standards

set -e

ERRORS=0
WARNINGS=0

echo "======================================"
echo "Anti-Pattern Scan"
echo "======================================"
echo ""

# Color codes for output (optional, professional)
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# 1. Hardcoded Configuration Scan
echo "[1/8] Scanning for hardcoded configuration..."

HARDCODED_DB=$(grep -rE "(const|let).*=.*['\"].*-(prod|staging|dev)['\"]" api/ src/ --exclude-dir=node_modules --exclude="*.test.ts" 2>/dev/null || true)
if [ -n "$HARDCODED_DB" ]; then
  echo -e "${RED}FAIL${NC}: Hardcoded database/environment names found:"
  echo "$HARDCODED_DB"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}PASS${NC}: No hardcoded database names"
fi

HARDCODED_KEYS=$(grep -rE "(sk_live|sk_test|pk_live|pk_test|api_key.*=.*['\"])" api/ src/ --exclude-dir=node_modules 2>/dev/null || true)
if [ -n "$HARDCODED_KEYS" ]; then
  echo -e "${RED}FAIL${NC}: Hardcoded API keys found:"
  echo "$HARDCODED_KEYS"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}PASS${NC}: No hardcoded API keys"
fi

HARDCODED_URLS=$(grep -rE "https?://[a-zA-Z0-9.-]+\.(com|io|dev|net)" api/ src/ --exclude-dir=node_modules --exclude="vite.config.ts" --exclude="*.test.ts" 2>/dev/null || true)
if [ -n "$HARDCODED_URLS" ]; then
  echo -e "${YELLOW}WARN${NC}: Hardcoded URLs found (verify these are correct):"
  echo "$HARDCODED_URLS"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""

# 2. Incomplete Work Scan
echo "[2/8] Scanning for incomplete implementations..."

INCOMPLETE=$(grep -riE "todo|fixme|hack|placeholder|temporary|not implemented|for now|in production|later|stub|mock implementation" \
  api/ src/ docs/ \
  --exclude-dir=node_modules \
  --exclude-dir=tests \
  --exclude=CHANGELOG.md \
  --exclude="anti-pattern-scan.sh" \
  2>/dev/null || true)

if [ -n "$INCOMPLETE" ]; then
  echo -e "${RED}FAIL${NC}: Incomplete implementations found:"
  echo "$INCOMPLETE"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}PASS${NC}: No incomplete work markers"
fi

echo ""

# 3. CommonJS Scan
echo "[3/8] Scanning for CommonJS syntax..."

COMMONJS=$(grep -rE "require\(|module\.exports|exports\." api/ src/ --exclude-dir=node_modules 2>/dev/null || true)
if [ -n "$COMMONJS" ]; then
  echo -e "${RED}FAIL${NC}: CommonJS syntax found (use ES modules):"
  echo "$COMMONJS"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}PASS${NC}: ES modules only"
fi

echo ""

# 4. Emoji Scan
echo "[4/8] Scanning for emojis..."

# Use file command to detect non-ASCII characters (more portable)
EMOJIS=$(find api/ src/ docs/ -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" \) -exec file {} \; 2>/dev/null | grep -i "UTF-8 Unicode.*emoji" || true)

# Fallback: check for common emoji patterns (more reliable cross-platform)
if [ -z "$EMOJIS" ]; then
  EMOJIS=$(LC_ALL=C grep -r '[^\x00-\x7F]' api/ src/ docs/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --exclude-dir=node_modules 2>/dev/null | grep -E '[\xF0][\x9F]' || true)
fi

if [ -n "$EMOJIS" ]; then
  echo -e "${RED}FAIL${NC}: Emojis or non-ASCII characters found in codebase:"
  echo "$EMOJIS" | head -10
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}PASS${NC}: No emojis"
fi

echo ""

# 5. TypeScript Compilation
echo "[5/8] Validating TypeScript compilation..."

if npm run typecheck >/dev/null 2>&1; then
  echo -e "${GREEN}PASS${NC}: TypeScript compiles"
else
  echo -e "${RED}FAIL${NC}: TypeScript compilation errors"
  npm run typecheck 2>&1 | tail -20
  ERRORS=$((ERRORS + 1))
fi

echo ""

# 6. Build Validation
echo "[6/8] Validating build..."

if npm run build >/dev/null 2>&1; then
  echo -e "${GREEN}PASS${NC}: Build succeeds"
else
  echo -e "${RED}FAIL${NC}: Build errors"
  npm run build 2>&1 | tail -20
  ERRORS=$((ERRORS + 1))
fi

echo ""

# 7. File Count Check (Over-Engineering Detection)
echo "[7/8] Checking for over-engineering..."

API_FILE_COUNT=$(find api/ -type f -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
if [ "$API_FILE_COUNT" -gt 30 ]; then
  echo -e "${YELLOW}WARN${NC}: $API_FILE_COUNT files in api/ (verify all necessary)"
  WARNINGS=$((WARNINGS + 1))
else
  echo -e "${GREEN}PASS${NC}: Reasonable file count ($API_FILE_COUNT files)"
fi

GENERIC_FOLDERS=$(find api/ src/ -type d -name "utils" -o -name "helpers" -o -name "common" 2>/dev/null || true)
if [ -n "$GENERIC_FOLDERS" ]; then
  echo -e "${YELLOW}WARN${NC}: Generic folder names found (use descriptive names):"
  echo "$GENERIC_FOLDERS"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""

# 8. Secrets in Code Scan
echo "[8/8] Scanning for secrets in code..."

SECRETS=$(grep -rE "(password|secret|key|token).*=.*['\"][a-zA-Z0-9]{20,}" api/ src/ --exclude-dir=node_modules --exclude="*.test.ts" 2>/dev/null || true)
if [ -n "$SECRETS" ]; then
  echo -e "${RED}FAIL${NC}: Potential secrets found in code:"
  echo "$SECRETS"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}PASS${NC}: No secrets detected"
fi

echo ""

# Summary
echo "======================================"
echo "Scan Summary"
echo "======================================"
echo "Errors: $ERRORS"
echo "Warnings: $WARNINGS"
echo ""

if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}SCAN FAILED${NC}: Fix errors before proceeding"
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo -e "${YELLOW}SCAN PASSED WITH WARNINGS${NC}: Review warnings"
  exit 0
else
  echo -e "${GREEN}SCAN PASSED${NC}: No issues found"
  exit 0
fi
