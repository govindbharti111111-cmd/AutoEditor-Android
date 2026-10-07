#!/usr/bin/env bash
# AutoEditor for Android (Termux).  Run:  bash start.sh
cd "$(dirname "$0")"

# Windows-made zips drop Unix permissions, which makes the extracted folders
# non-searchable and the server hit EACCES. Restore read + dir-execute here.
chmod -R u+rwX . 2>/dev/null || true

# First run: install only Node.js. KineMaster export does not need ffmpeg.
# Install ffmpeg separately only if you also want MP4 rendering.
if ! command -v node >/dev/null 2>&1; then
  echo "First run: installing Node.js (one-time, needs internet)..."
  yes | pkg update >/dev/null 2>&1 || pkg update -y
  pkg install -y nodejs
fi

if ! command -v node >/dev/null 2>&1; then echo "Node.js install failed. Try: pkg install nodejs"; exit 1; fi
FF="$(command -v ffmpeg 2>/dev/null || true)"
if [ -n "$FF" ]; then export FFMPEG_PATH="$FF"; fi
export CAPTION_FONT_PATH="$(pwd)/caption.ttf"
export FRONTEND_DIR="$(pwd)/out"
export # OPEN_BROWSER=0
export PORT="${PORT:-4000}"

# Keep the phone usable during a render:
#  - RENDER_THREADS caps CPU cores used for filtering/software-encoding
#    (default ~half the cores; RENDER_THREADS=0 = all cores).
#  - RENDER_NICE runs ffmpeg at low OS priority so foreground apps get CPU first.
#  - RENDER_ZOOM_SS lowers the Ken Burns supersample (biggest CPU/RAM cost of
#    zoom); 2 keeps the phone responsive, 3 is smoothest but heaviest.
# The app also auto-tries the phone's hardware video encoder (h264_mediacodec,
# the same silicon CapCut/KineMaster use) and only falls back to CPU libx264 if
# it isn't available. Force CPU with RENDER_ENCODER=libx264 if a render looks bad.
CORES="$(nproc 2>/dev/null || echo 4)"
export RENDER_THREADS="${RENDER_THREADS:-$(( CORES > 2 ? (CORES + 1) / 2 : 1 ))}"
export RENDER_NICE="${RENDER_NICE:-18}"
export RENDER_ZOOM_SS="${RENDER_ZOOM_SS:-2}"
echo "Render load: RENDER_THREADS=$RENDER_THREADS RENDER_NICE=$RENDER_NICE RENDER_ZOOM_SS=$RENDER_ZOOM_SS (hardware encoder auto-detected)"

# Make sure Termux can reach shared storage (Download etc.). If it isn't set up
# yet, run termux-setup-storage — it pops a one-time Android permission dialog;
# tap Allow. Without this, saves land in Termux-private storage that file apps
# can't open.
if [ ! -d "$HOME/storage" ]; then
  echo "Setting up storage access — tap Allow on the permission dialog..."
  termux-setup-storage 2>/dev/null || true
  sleep 3
fi

# Auto-save finished videos where the user can actually find them: the phone's
# Download folder (visible in Files, Gallery, and every file manager). Fall back
# to shared-storage root, then Termux-private storage as a last resort.
if [ -d "$HOME/storage/downloads" ]; then
  export OUTPUT_DIR="$HOME/storage/downloads/AutoEditor"
elif [ -d "$HOME/storage/shared" ]; then
  export OUTPUT_DIR="$HOME/storage/shared/AutoEditor"
else
  export OUTPUT_DIR="$HOME/AutoEditor-output"
fi
mkdir -p "$OUTPUT_DIR" 2>/dev/null || true
# Resolve the Termux storage symlink to the real path (/storage/emulated/0/...)
# so logs show the folder the user actually sees in Files/Gallery, not the
# confusing /data/data/com.termux/.../storage/downloads symlink path.
REAL_OUT="$(cd "$OUTPUT_DIR" 2>/dev/null && pwd -P)"
[ -n "$REAL_OUT" ] && export OUTPUT_DIR="$REAL_OUT"

# Keep the CPU running during long renders even when the screen is locked.
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock && echo "Wake-lock acquired — CPU stays on with the screen off."
else
  echo "termux-wake-lock missing. Install it:  pkg install termux-tools"
fi
trap 'termux-wake-unlock 2>/dev/null || true' EXIT
echo ""
echo "IMPORTANT: if rendering PAUSES when you lock the screen, Android is freezing"
echo "Termux. Turn OFF battery optimization for it (one time):"
echo "  Android Settings > Apps > Termux > Battery > Unrestricted (Don't optimize)."
echo "Then rendering keeps going with the screen locked."
echo ""

echo "AutoEditor is running."
if [ -z "${FF:-}" ]; then echo "KineMaster export works without ffmpeg. MP4 rendering requires: pkg install ffmpeg"; fi
echo "Open  http://localhost:${PORT}  in Chrome/Firefox on this phone."
echo "Finished videos are saved to:  $OUTPUT_DIR"
echo "You can close the browser after hitting Render — it keeps rendering and saves there."
echo "To check progress after closing the browser: switch back to Termux (it prints Rendering... %)."
echo "Keep this Termux session open. Press Ctrl+C to stop."
node bundle.cjs
