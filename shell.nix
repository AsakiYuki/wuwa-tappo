{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs
    electron
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
    libxkbfile
    libxkbcommon
    xkeyboard_config
    wmctrl
  ];
  shellHook = ''
    unset ELECTRON_RUN_AS_NODE
    export ELECTRON_OZONE_PLATFORM_HINT="x11"
    export ELECTRON_OVERRIDE_DIST_PATH="${pkgs.electron}/bin"
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [
      pkgs.nspr
      pkgs.nss
      pkgs.atk
      pkgs.at-spi2-atk
      pkgs.cups
      pkgs.libdrm
      pkgs.gtk3
      pkgs.pango
      pkgs.libcxx
      pkgs.libGL
      pkgs.mesa
      pkgs.udev
      pkgs.alsa-lib
      pkgs.libX11
      pkgs.libXrandr
      pkgs.libXtst
      pkgs.libXt
      pkgs.libxkbfile
      pkgs.libxkbcommon
    ]}:$LD_LIBRARY_PATH"
    export XKB_CONFIG_ROOT="${pkgs.xkeyboard_config}/etc/X11/xkb"
  '';
}

