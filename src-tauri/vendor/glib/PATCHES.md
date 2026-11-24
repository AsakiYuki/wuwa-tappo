# Vendored glib 0.18.5

The `glib` 0.18.5 crate from crates.io (sha256 `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`),
without its tests and benches, and with one change:

- `src/variant_iter.rs`, `VariantStrIter::impl_get`: `p` is mutable and passed as `&mut p`, as in glib
  0.20 (RUSTSEC-2024-0429, GHSA-wrw7-89jp-8q8g). C writes through that pointer; with `&p` the
  compiler may assume it stays null.

The version stays 0.18.5 because the GTK 3 crates require `^0.18`, so scanners that only compare
versions may still report it.
