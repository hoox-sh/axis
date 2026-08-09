// Copyright (c) 2026 HOOX · AXIS · jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

//! AXIS desktop host (Tauri 2).
//!
//! - Native **File** / **Help** menus
//! - `open_pine_scripts` command: system file dialog + UTF-8 read
//! - Emits `axis-menu` events for frontend handlers

use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{
  menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
  AppHandle, Emitter, Runtime,
};
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Soft cap per file (8 MiB) — chart scripts are text; reject runaway loads.
const MAX_SCRIPT_BYTES: u64 = 8 * 1024 * 1024;

/// One script opened from disk (basename + path + body).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedPineScript {
  pub name: String,
  pub path: String,
  pub content: String,
}

fn is_pine_path(path: &Path) -> bool {
  path
    .extension()
    .and_then(|e| e.to_str())
    .map(|ext| {
      let e = ext.to_ascii_lowercase();
      matches!(
        e.as_str(),
        "pyne" | "pine" | "pinescript" | "pinev5" | "pinev6"
      )
    })
    .unwrap_or(false)
}

fn file_path_to_pathbuf(fp: FilePath) -> Option<std::path::PathBuf> {
  match fp {
    FilePath::Path(p) => Some(p),
    FilePath::Url(url) => url.to_file_path().ok(),
  }
}

fn read_pine_file(path: &Path) -> Result<OpenedPineScript, String> {
  let meta = fs::metadata(path).map_err(|e| format!("{}: {}", path.display(), e))?;
  if !meta.is_file() {
    return Err(format!("{}: not a file", path.display()));
  }
  if meta.len() > MAX_SCRIPT_BYTES {
    return Err(format!(
      "{}: too large ({} bytes, max {})",
      path.display(),
      meta.len(),
      MAX_SCRIPT_BYTES
    ));
  }
  let content = fs::read_to_string(path).map_err(|e| format!("{}: {}", path.display(), e))?;
  let name = path
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("script.pyne")
    .to_string();
  Ok(OpenedPineScript {
    name,
    path: path.display().to_string(),
    content,
  })
}

/// Native multi-select open dialog for Pine / PYNE sources.
///
/// Returns `null` (JSON) when the user cancels; otherwise an array (possibly
/// empty if only non-script files were chosen after filter bypass).
#[tauri::command]
async fn open_pine_scripts(app: AppHandle) -> Result<Option<Vec<OpenedPineScript>>, String> {
  let app2 = app.clone();
  let picked = tauri::async_runtime::spawn_blocking(move || {
    app2
      .dialog()
      .file()
      .add_filter(
        "Pine Script",
        &["pyne", "pine", "pinescript", "pinev5", "pinev6"],
      )
      .add_filter("All files", &["*"])
      .set_title("Open Pine Script")
      .blocking_pick_files()
  })
  .await
  .map_err(|e| format!("dialog task failed: {e}"))?;

  let Some(files) = picked else {
    return Ok(None);
  };

  let mut out = Vec::new();
  let mut errors = Vec::new();
  for fp in files {
    let Some(path) = file_path_to_pathbuf(fp) else {
      continue;
    };
    if !is_pine_path(&path) {
      continue;
    }
    match read_pine_file(&path) {
      Ok(script) => out.push(script),
      Err(e) => errors.push(e),
    }
  }

  if out.is_empty() && !errors.is_empty() {
    return Err(errors.join("; "));
  }
  // Surface soft errors via empty list + frontend message when nothing valid
  let _ = errors;
  Ok(Some(out))
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
  let open = MenuItem::with_id(
    app,
    "open_script",
    "Open Script…",
    true,
    Some("CmdOrCtrl+O"),
  )?;
  let sep = PredefinedMenuItem::separator(app)?;
  let quit = PredefinedMenuItem::quit(app, Some("Quit AXIS"))?;
  let file = Submenu::with_items(app, "File", true, &[&open, &sep, &quit])?;

  let about = MenuItem::with_id(app, "about", "About AXIS", true, None::<&str>)?;
  let help = Submenu::with_items(app, "Help", true, &[&about])?;

  Menu::with_items(app, &[&file, &help])
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
  match event.id().as_ref() {
    "open_script" => {
      let _ = app.emit("axis-menu", "open_script");
    }
    "about" => {
      let _ = app.emit("axis-menu", "about");
    }
    _ => {}
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let menu = build_menu(app.handle())?;
      app.set_menu(menu)?;
      app.on_menu_event(|app, event| on_menu_event(app, event));

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![open_pine_scripts])
    .run(tauri::generate_context!())
    .expect("error while running AXIS desktop");
}
