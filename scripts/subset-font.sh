#!/usr/bin/env bash
# Makes web/public/fonts/NotoSansJP-subset.ttf, the font a split's PDF export writes
# its text in, so Latin and Japanese names and items show in the PDF.
#
# The source is the static Noto Sans JP Regular TrueType font (SIL Open Font License,
# web/public/fonts/OFL.txt). One copy is in the @expo-google-fonts/noto-sans-jp npm
# package, version 0.4.4:
#
#   curl -sSfLO https://registry.npmjs.org/@expo-google-fonts/noto-sans-jp/-/noto-sans-jp-0.4.4.tgz
#   tar xzf noto-sans-jp-0.4.4.tgz package/400Regular/NotoSansJP_400Regular.ttf
#   scripts/subset-font.sh package/400Regular/NotoSansJP_400Regular.ttf
#
# (NotoSansJP_400Regular.ttf there has SHA-256
# 6255ea4692e97ef27330304fb96fd650f9111f868cd585fcf2802d42823930e5.)
#
# jsPDF needs a static TrueType font: not a variable font, WOFF or WOFF2. It doesn't
# use OpenType layout or vertical metrics, so those are left out to keep the file small.
#
# Kept: ASCII, Latin-1, general punctuation, currency symbols, arrows, the minus sign,
# CJK symbols and punctuation, hiragana, katakana (and its phonetic extensions),
# full-width and half-width forms, and the JIS X 0208 level 1 and 2 kanji (6,355).
# Anything else (Korean, Thai, Chinese-only characters) shows as a blank in the PDF.
#
# Needs Python 3 with fontTools (pip install fonttools).
set -euo pipefail

src=${1:?Usage: scripts/subset-font.sh path/to/NotoSansJP-Regular.ttf}
out="$(cd "$(dirname "$0")/.." && pwd)/web/public/fonts/NotoSansJP-subset.ttf"

ranges=(
  U+0020-007E # ASCII
  U+00A0-00FF # Latin-1
  U+2000-206F # General punctuation
  U+20A0-20CF # Currency symbols
  U+2190-2193 # Arrows
  U+2212      # Minus sign
  U+3000-303F # CJK symbols and punctuation
  U+3040-309F # Hiragana
  U+30A0-30FF # Katakana
  U+31F0-31FF # Katakana phonetic extensions
  U+FF00-FFEF # Full-width and half-width forms
)

list=$(mktemp)
trap 'rm -f "$list"' EXIT
printf '%s\n' "${ranges[@]}" >"$list"

# JIS X 0208 kanji: rows 16 to 47 are level 1, rows 48 to 84 level 2. Each is read
# through its EUC-JP code, which is the row and cell plus 0xA0.
python3 -I -c '
for row in range(16, 85):
    for cell in range(1, 95):
        try:
            print("U+%04X" % ord(bytes([0xA0 + row, 0xA0 + cell]).decode("euc_jp")))
        except UnicodeDecodeError:
            pass
' >>"$list"

python3 -I -m fontTools.subset "$src" \
  --unicodes-file="$list" \
  --layout-features='' \
  --drop-tables+=GSUB,GPOS,GDEF,BASE,STAT,vhea,vmtx \
  --no-hinting \
  --output-file="$out"

echo "Wrote $out ($(wc -c <"$out") bytes)"
