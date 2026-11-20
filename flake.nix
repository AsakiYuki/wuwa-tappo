{
  description = "Wuwa Tappo - Desktop Companion";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        wuwa-tappo = pkgs.callPackage ./nix/package.nix { };
        default = wuwa-tappo;
      });

      # `nix develop`: same environment as `nix-shell` for working on the app.
      devShells = forAllSystems (pkgs: {
        default = import ./shell.nix { inherit pkgs; };
      });

      overlays.default = final: _prev: {
        wuwa-tappo = final.callPackage ./nix/package.nix { };
      };

      nixosModules.default = import ./nix/module.nix self;
      nixosModules.wuwa-tappo = self.nixosModules.default;

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
