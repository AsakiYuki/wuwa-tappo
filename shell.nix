{ pkgs ? import <nixpkgs> {} }:
let
  # Libraries loaded at run time (dlopen), so they must be on LD_LIBRARY_PATH rather than only linked.
  runtimeLibs = with pkgs; [
    gtk3
    libGL
    mesa
    udev
    libX11
    libXtst
    libXi
    libxkbcommon
    # The tray icon, where no StatusNotifierItem host is running.
    libayatana-appindicator
    # The prebuilt Tauri CLI (`npm run build`).
    xz
  ];
in
pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    nodejs
    # Rust toolchain from nixpkgs, so a rustup without a default toolchain does not matter.
    cargo
    rustc
    pkg-config
  ];

  buildInputs = runtimeLibs ++ (with pkgs; [
    # Tauri's webkit2gtk 4.1 stack
    webkitgtk_4_1
    libsoup_3
    librsvg
    glib
    openssl
    gsettings-desktop-schemas
    # On Wayland the pet is a layer-shell surface.
    gtk-layer-shell
  ]);

  shellHook = ''
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath runtimeLibs}:$LD_LIBRARY_PATH"
    export XKB_CONFIG_ROOT="${pkgs.xkeyboard_config}/etc/X11/xkb"
    # GTK needs its GSettings schemas outside a wrapped (wrapGAppsHook) binary.
    export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
  '';
}
