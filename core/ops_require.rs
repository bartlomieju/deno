// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
use crate::OpDecl;
use deno_ops::op;
use std::path::PathBuf;

pub(crate) fn init_require() -> Vec<OpDecl> {
  vec![
    op_require_init_paths::decl(),
    op_require_node_module_paths::decl(),
    ]
}

#[op]
pub fn op_require_init_paths() -> Vec<String> {
  let (home_dir, node_path) = if cfg!(target_os = "windows") {
    (
      std::env::var("USERPROFILE").unwrap_or_else(|_| "".into()),
      std::env::var("NODE_PATH").unwrap_or_else(|_| "".into()),
    )
  } else {
    (
      std::env::var("HOME").unwrap_or_else(|_| "".into()),
      std::env::var("NODE_PATH").unwrap_or_else(|_| "".into()),
    )
  };

  let mut prefix_dir = std::env::current_exe().unwrap();
  if cfg!(target_os = "windows") {
    prefix_dir = prefix_dir.join("..").join("..")
  } else {
    prefix_dir = prefix_dir.join("..")
  }

  let mut paths = vec![prefix_dir.join("lib").join("node")];

  if !home_dir.is_empty() {
    paths.insert(0, PathBuf::from(&home_dir).join(".node_libraries"));
    paths.insert(0, PathBuf::from(&home_dir).join(".nod_modules"));
  }

  let mut paths = paths.into_iter().map(|p| p.to_string_lossy().to_string()).collect();
  
  if !node_path.is_empty() {
    let delimiter = if cfg!(target_os = "windows") {
      ";"
    } else {
      ":"
    };
    let mut node_paths: Vec<String> = node_path
      .split(delimiter)
      .filter(|e| !e.is_empty())
      .map(|s| s.to_string())
      .collect();
    node_paths.append(&mut paths);
    paths = node_paths;
  }

  paths
}


#[op]
pub fn op_require_node_module_paths(from: String) -> Vec<String> {
  let mut paths = vec![];

  if cfg!(target_os = "windows") {

  } else {
    // Guarantee that "from" is absolute.
    // TODO:

    if from == "/" {
      return vec!["/node_modules".to_string()];
    }

    let mut paths = vec![];

    
    // Append /node_modules to handle root paths.
    paths.push("/node_modules".to_string());
  }

  paths
}