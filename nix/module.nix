# NixOS module: `programs.wuwa-tappo`.
self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.wuwa-tappo;
  inputRules = pkgs.writeTextFile {
    name = "wuwa-tappo-input-udev-rules";
    text = builtins.readFile ../packaging/linux/70-wuwa-tappo-input.rules;
    destination = "/lib/udev/rules.d/70-wuwa-tappo-input.rules";
  };
in
{
  options.programs.wuwa-tappo = {
    enable = lib.mkEnableOption "Wuwa Tappo, a desktop companion pet";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "wuwa-tappo.packages.\${pkgs.stdenv.hostPlatform.system}.default";
      description = "The Wuwa Tappo package to install.";
    };

    inputAccess = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Let the active local user read /dev/input/event* (udev `uaccess` tag), which global key
        and mouse tracking needs on Wayland. Without it the pet only reacts under X11 or while focused.

        Security: every program that user runs can then read raw keystrokes, including passwords.
        systemd-logind grants the access only to the user of the active seat and revokes it on logout.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];
    services.udev.packages = lib.mkIf cfg.inputAccess [ inputRules ];
  };
}
