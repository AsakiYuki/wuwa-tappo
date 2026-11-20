#!/usr/bin/env bash
set -euo pipefail

user="$(id -un)"

echo "=== Wuwa Tappo - Input Permission Setup ==="
echo "On Linux / Wayland, global keyboard and mouse tracking requires read access to /dev/input/event*."
echo ""
echo "WARNING: this access applies to EVERY program running as '$user', not only Wuwa Tappo."
echo "Any of them will be able to read raw keystrokes (including passwords)."
echo ""
read -r -p "Continue? [y/N] " answer
case "$answer" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Cancelled."; exit 0 ;;
esac

if command -v setfacl >/dev/null 2>&1; then
    sudo setfacl -m "u:${user}:r" /dev/input/event*
    echo "[✓] Read permissions granted (until the devices are re-created, usually at reboot)."
else
    echo "[!] setfacl not found."
    echo "    The alternative is adding '$user' to the 'input' group, which grants this access PERMANENTLY."
    read -r -p "Add '$user' to the input group? [y/N] " answer
    case "$answer" in
        [yY]|[yY][eE][sS]) ;;
        *) echo "Cancelled."; exit 0 ;;
    esac
    sudo usermod -aG input "$user"
    echo "[✓] Added $user to group input (requires relogin). Undo with: sudo gpasswd -d $user input"
fi

echo ""
echo "Done! You can now start or restart Wuwa Tappo."
