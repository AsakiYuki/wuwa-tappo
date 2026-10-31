#!/usr/bin/env bash
set -e

echo "=== Wuwa Tappo - Input Permission Setup ==="
echo "On Linux / Wayland, global keyboard and mouse tracking requires read access to /dev/input/event*."
echo "Granting read access for user: $USER ..."

if command -v setfacl >/dev/null 2>&1; then
    sudo setfacl -m u:$USER:r /dev/input/event*
    echo "[✓] Read permissions granted successfully!"
else
    echo "[!] setfacl not found. Adding user to input group..."
    sudo usermod -aG input "$USER"
    echo "[✓] Added $USER to group input (requires relogin)."
fi

echo ""
echo "Done! You can now start or restart Wuwa Tappo."

