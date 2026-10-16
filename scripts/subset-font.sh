#!/usr/bin/env bash
# Makes web/public/fonts/NotoSansJP-subset-v2.ttf, the font a split's PDF export
# writes its text in, so Latin and Japanese names and items show in the PDF. The
# service worker keeps a font for good, so a changed font gets a new name (-v3, ...).
#
# The source is the static Noto Sans JP Regular TrueType font (SIL Open Font License,
# web/public/fonts/OFL.txt). One copy is in the @expo-google-fonts/noto-sans-jp npm
# package, version 0.4.4:
#
#   curl -sSfLO https://registry.npmjs.org/@expo-google-fonts/noto-sans-jp/-/noto-sans-jp-0.4.4.tgz
#   tar xzf noto-sans-jp-0.4.4.tgz package/400Regular/NotoSansJP_400Regular.ttf
#   curl -sSfLO https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip
#   unzip Unihan.zip Unihan_OtherMappings.txt
#   scripts/subset-font.sh package/400Regular/NotoSansJP_400Regular.ttf Unihan_OtherMappings.txt
#
# (NotoSansJP_400Regular.ttf there has SHA-256
# 6255ea4692e97ef27330304fb96fd650f9111f868cd585fcf2802d42823930e5, and
# Unihan_OtherMappings.txt from Unicode 18.0.0 has SHA-256
# fc7bbb8f923fa1e922a4d421aa15387d1c68250cc5e7619bdf81f575ab38472b.)
#
# jsPDF needs a static TrueType font: not a variable font, WOFF or WOFF2. It doesn't
# use OpenType layout or vertical metrics, so those are left out to keep the file small.
#
# Kept: ASCII, Latin-1, general punctuation, currency symbols, arrows, the minus sign,
# CJK symbols and punctuation, hiragana, katakana (and its phonetic extensions),
# full-width and half-width forms, and these kanji:
#   - JIS X 0208 level 1 (2,965), the common ones;
#   - every Joyo kanji (everyday writing) and Jinmeiyo kanji (allowed in people's
#     names), with the variant forms Unicode links to them, from Unihan.
# The rest of JIS level 2 (about 3,200 rare kanji) is left out, which keeps the file
# under 2 MB. Anything not kept (rare kanji, Korean, Thai, Chinese-only characters)
# shows as a blank in the PDF.
#
# Needs Python 3 with fontTools (pip install fonttools).
set -euo pipefail

usage='Usage: scripts/subset-font.sh path/to/NotoSansJP-Regular.ttf path/to/Unihan_OtherMappings.txt'
src=${1:?$usage}
unihan=${2:?$usage}
out="$(cd "$(dirname "$0")/.." && pwd)/web/public/fonts/NotoSansJP-subset-v2.ttf"

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

# JIS X 0208 level 1 kanji are rows 16 to 47, each read through its EUC-JP code (the
# row and cell plus 0xA0). Joyo and Jinmeiyo kanji are marked in Unihan; a value
# naming another character (U+...) links a variant form, which is kept too.
python3 -I -c '
import re, sys
kanji = set()
for row in range(16, 48):
    for cell in range(1, 95):
        try:
            kanji.add(ord(bytes([0xA0 + row, 0xA0 + cell]).decode("euc_jp")))
        except UnicodeDecodeError:
            pass
for line in open(sys.argv[1], encoding="utf-8"):
    fields = line.rstrip("\n").split("\t")
    if len(fields) == 3 and fields[1] in ("kJoyoKanji", "kJinmeiyoKanji"):
        kanji.add(int(fields[0][2:], 16))
        kanji.update(int(ref, 16) for ref in re.findall(r"U\+([0-9A-F]+)", fields[2]))
print("\n".join("U+%04X" % k for k in sorted(kanji)))
' "$unihan" >>"$list"

python3 -I -m fontTools.subset "$src" \
  --unicodes-file="$list" \
  --layout-features='' \
  --drop-tables+=GSUB,GPOS,GDEF,BASE,STAT,vhea,vmtx \
  --no-hinting \
  --output-file="$out"

echo "Wrote $out ($(wc -c <"$out") bytes)"
