// Copyright (c) 2026 HOOX · AXIS · jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  axis_lib::run();
}
