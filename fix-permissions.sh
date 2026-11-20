#!/usr/bin/env bash
set -euo pipefail

user="$(id -un)"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rule="$here/packaging/linux/70-wuwa-tappo-input.rules"

echo "=== Wuwa Tappo - Input Permission Setup ==="
echo "On Linux / Wayland, global keyboard and mouse tracking requires read access to /dev/input/event*."
echo ""

if [ -e /etc/NIXOS ]; then
    echo "NixOS detected: /etc is managed declaratively, so enable the flake NixOS module option instead:"
    echo ""
    echo "    programs.wuwa-tappo.enable = true;"
    echo "    programs.wuwa-tappo.inputAccess = true;"
    echo ""
    echo "then run 'sudo nixos-rebuild switch' and log in again."
    exit 0
fi

echo "WARNING: this access applies to EVERY program running as '$user', not only Wuwa Tappo."
echo "Any of them will be able to read raw keystrokes (including passwords)."
echo ""
echo "  1) Until reboot      (setfacl on the current devices)"
echo "  2) Permanently       (udev 'uaccess' rule: only while you are the active local user)"
echo "  3) Permanently       (add '$user' to the 'input' group)"
echo "  *) Cancel"
read -r -p "Choose [1/2/3]: " answer

case "$answer" in
    1)
        if ! command -v setfacl >/dev/null 2>&1; then
            echo "[!] setfacl not found; install your distribution's 'acl' package or choose 2."
            exit 1
        fi
        sudo setfacl -m "u:${user}:r" /dev/input/event*
        echo "[✓] Read permissions granted (until the devices are re-created, usually at reboot)."
        ;;
    2)
        sudo install -m 644 "$rule" /etc/udev/rules.d/70-wuwa-tappo-input.rules
        sudo udevadm control --reload
        sudo udevadm trigger --subsystem-match=input
        echo "[✓] Installed /etc/udev/rules.d/70-wuwa-tappo-input.rules. Log out and back in if it does not apply yet."
        echo "    Undo with: sudo rm /etc/udev/rules.d/70-wuwa-tappo-input.rules"
        ;;
    3)
        sudo usermod -aG input "$user"
        echo "[✓] Added $user to group input (requires relogin). Undo with: sudo gpasswd -d $user input"
        ;;
    *)
        echo "Cancelled."
        exit 0
        ;;
esac

echo ""
echo "Done! You can now start or restart Wuwa Tappo."
