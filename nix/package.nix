{
  lib,
  rustPlatform,
  fetchNpmDeps,
  npmHooks,
  nodejs,
  pkg-config,
  wrapGAppsHook3,
  makeDesktopItem,
  copyDesktopItems,
  dbus,
  glib-networking,
  gtk-layer-shell,
  gtk3,
  libayatana-appindicator,
  librsvg,
  libsoup_3,
  openssl,
  webkitgtk_4_1,
  xorg,
  # Top-level names in current nixpkgs; the xorg.* fallbacks keep older releases working.
  libx11 ? xorg.libX11,
  libxi ? xorg.libXi,
  libxtst ? xorg.libXtst,
}:

let
  packageJson = lib.importJSON ../package.json;
  tauriConfig = lib.importJSON ../src-tauri/tauri.conf.json;
  fs = lib.fileset;
  root = ../.;
  # Only what the build reads, so unrelated edits (docs, CI) do not trigger rebuilds.
  src = fs.toSource {
    inherit root;
    fileset = fs.unions [
      ../package.json
      ../package-lock.json
      ../asset-manifest.json
      ../assets
      ../src
      ../scripts
      ../tsconfig.json
      ../tsconfig.test.json
      ../vite.config.mts
      ../vite.backend.mts
      ../src-tauri/Cargo.toml
      ../src-tauri/Cargo.lock
      ../src-tauri/build.rs
      ../src-tauri/bridge.js
      ../src-tauri/capabilities
      ../src-tauri/src
      ../src-tauri/tauri.conf.json
      ../src-tauri/tauri.linux.conf.json
      ../src-tauri/vendor
    ];
  };
in
rustPlatform.buildRustPackage {
  pname = "wuwa-tappo";
  inherit (packageJson) version;
  inherit src;

  cargoRoot = "src-tauri";
  buildAndTestSubdir = "src-tauri";
  cargoLock.lockFile = ../src-tauri/Cargo.lock;
  # What `tauri build` enables: serve the embedded pages instead of a development server.
  buildFeatures = [ "tauri/custom-protocol" ];

  # Update after changing package-lock.json: set to lib.fakeHash, build, and copy the hash from the error.
  # (importNpmLock cannot be used: it breaks the `typescript-vue` npm alias.)
  npmDeps = fetchNpmDeps {
    name = "wuwa-tappo-npm-deps";
    inherit src;
    hash = "sha256-JycS5ZeuLO1c+EFPMkdVjrg4VTzYKX0hZwS7gDjpLeM=";
  };
  npmRebuildFlags = [ "--ignore-scripts" ];

  env.BUILD_VERSION = packageJson.version;

  nativeBuildInputs = [
    nodejs
    npmHooks.npmConfigHook
    pkg-config
    wrapGAppsHook3
    copyDesktopItems
  ];
  buildInputs = [
    dbus
    glib-networking
    gtk-layer-shell
    gtk3
    librsvg
    libsoup_3
    libx11
    libxi
    libxtst
    openssl
    webkitgtk_4_1
  ];

  # The pages and the game logic, which the binary embeds.
  preBuild = ''
    node scripts/tauri-prepare.cjs
  '';

  doCheck = true;
  preCheck = ''
    npm test
  '';
  # These look at who owns system files, which is not root in the build sandbox.
  checkFlags = map (test: "--skip=linux_input_access::tests::" + test) [
    "executables_outside_root_controlled_directories_are_refused"
    "system_executables_resolve_to_root_owned_files"
  ];

  postInstall = ''
    install -Dm644 assets/appicon.png $out/share/icons/hicolor/256x256/apps/wuwa-tappo.png
  '';

  # Loaded at run time, for the tray where no StatusNotifierItem host is running.
  preFixup = ''
    gappsWrapperArgs+=(--prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ libayatana-appindicator ]})
  '';

  desktopItems = [
    (makeDesktopItem {
      name = tauriConfig.identifier;
      desktopName = tauriConfig.productName;
      comment = packageJson.description;
      exec = "wuwa-tappo";
      icon = "wuwa-tappo";
      categories = [ "Utility" ];
      startupWMClass = "wuwa-tappo";
      terminal = false;
    })
  ];

  meta = {
    description = packageJson.description;
    homepage = "https://github.com/AsakiYuki/wuwa-tappo";
    license = lib.licenses.mit;
    mainProgram = "wuwa-tappo";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
