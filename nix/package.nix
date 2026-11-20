{
  lib,
  stdenv,
  buildNpmPackage,
  nodejs,
  electron,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  autoPatchelfHook,
  wmctrl,
  acl,
  xorg,
  # Top-level names in current nixpkgs; the xorg.* fallbacks keep older releases working.
  libx11 ? xorg.libX11,
  libxrandr ? xorg.libXrandr,
  libxtst ? xorg.libXtst,
  libxt ? xorg.libXt,
  xprop ? xorg.xprop,
}:

let
  packageJson = lib.importJSON ../package.json;
  fs = lib.fileset;
  root = ../.;
  # Only what the build reads, so unrelated edits (docs, CI, dist/) do not trigger rebuilds.
  src = fs.toSource {
    inherit root;
    fileset = fs.unions [
      ../package.json
      ../package-lock.json
      ../assets
      ../src
      ../scripts
      ../tsconfig.json
      ../tsconfig.node.json
      ../vite.config.mts
    ];
  };
  uiohookArch =
    {
      x86_64-linux = "linux-x64";
      aarch64-linux = "linux-arm64";
    }
    .${stdenv.hostPlatform.system}
      or (throw "wuwa-tappo: unsupported system ${stdenv.hostPlatform.system}");
in
buildNpmPackage {
  pname = "wuwa-tappo";
  inherit (packageJson) version;
  inherit src nodejs;

  # Update after changing package-lock.json: set to lib.fakeHash, build, and copy the hash from the error.
  # (importNpmLock cannot be used: it breaks the `typescript-vue` npm alias.)
  npmDepsHash = "sha256-hYCLTGYHG1QGHIZAVp/bRlGydTHBLkypFXTPXBMv5M4=";

  # Install scripts would download Electron (the nixpkgs one is used instead); uiohook-napi ships
  # prebuilt addons, so nothing else needs them.
  npmRebuildFlags = [ "--ignore-scripts" ];

  env.BUILD_VERSION = packageJson.version;

  nativeBuildInputs = [
    makeWrapper
    copyDesktopItems
    autoPatchelfHook
  ];
  # uiohook-napi's prebuilt addon links against these X11 libraries.
  buildInputs = [
    libx11
    libxrandr
    libxtst
    libxt
  ];

  buildPhase = ''
    runHook preBuild
    npm run node:build
    npm run renderer:build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    app=$out/share/wuwa-tappo
    mkdir -p $app/node_modules
    cp -r runtime renderer-build assets package.json $app/
    # Vue is bundled into renderer-build by Vite; the main process only loads uiohook-napi.
    cp -r node_modules/{uiohook-napi,node-gyp-build} $app/node_modules/

    # macOS / Windows controller watchers, other platforms' addons and addon sources are unused here.
    rm -rf $app/assets/bin
    find $app/node_modules/uiohook-napi/prebuilds -mindepth 1 -maxdepth 1 ! -name ${uiohookArch} -exec rm -rf {} +
    rm -rf $app/node_modules/uiohook-napi/{libuiohook,src}

    install -Dm644 assets/appicon.png $out/share/icons/hicolor/256x256/apps/wuwa-tappo.png

    # --ozone-platform=x11: global input hooks and transparent click-through windows need X11/XWayland.
    # WUWA_TAPPO_LAUNCHER: lets launch-at-startup point at this wrapper instead of the bare Electron.
    # wmctrl/xprop/setfacl are appended to PATH so system versions win; pkexec must stay the
    # setuid wrapper from /run/wrappers, so it is deliberately not added.
    makeWrapper ${lib.getExe electron} $out/bin/wuwa-tappo \
      --add-flags --ozone-platform=x11 \
      --add-flags $app \
      --set WUWA_TAPPO_LAUNCHER $out/bin/wuwa-tappo \
      --suffix PATH : ${
        lib.makeBinPath [
          wmctrl
          xprop
          acl
        ]
      }

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = packageJson.desktopName;
      desktopName = packageJson.build.productName;
      comment = packageJson.description;
      exec = "wuwa-tappo %U";
      icon = "wuwa-tappo";
      categories = [ "Utility" ];
      startupWMClass = packageJson.desktopName;
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
