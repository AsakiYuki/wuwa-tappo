{ pkgs ? import <nixpkgs> {} }:
let
  # Libraries loaded at runtime (dlopen) by Electron and by the Tauri build, so they must be on
  # LD_LIBRARY_PATH rather than only linked.
  runtimeLibs = with pkgs; [
    nspr
    nss
    atk
    at-spi2-atk
    cups
    libdrm
    gtk3
    pango
    libcxx
    libGL
    mesa
    udev
    alsa-lib
    libX11
    libXrandr
    libXtst
    libXt
    libXi
    libxkbfile
    libxkbcommon
    libxcrypt-legacy
    # Tauri: the tray icon dlopens libayatana-appindicator.
    libayatana-appindicator
  ];
in
pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    nodejs
    # Tauri port (src-tauri): Rust toolchain from nixpkgs, so a rustup without a default toolchain
    # does not matter.
    cargo
    rustc
    pkg-config
  ];

  buildInputs = runtimeLibs ++ (with pkgs; [
    electron
    rpm
    xkeyboard_config
    wmctrl
    # Tauri (webkit2gtk 4.1 stack)
    webkitgtk_4_1
    libsoup_3
    librsvg
    glib
    openssl
    gsettings-desktop-schemas
    # Tauri on Wayland: the pet is a layer-shell surface.
    gtk-layer-shell
  ]);

  shellHook = ''
    unset ELECTRON_RUN_AS_NODE
    export ELECTRON_OZONE_PLATFORM_HINT="x11"
    export ELECTRON_OVERRIDE_DIST_PATH="${pkgs.electron}/bin"
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath runtimeLibs}:$LD_LIBRARY_PATH"
    export XKB_CONFIG_ROOT="${pkgs.xkeyboard_config}/etc/X11/xkb"
    # GTK needs its GSettings schemas outside a wrapped (wrapGAppsHook) binary.
    export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
  '';
}
