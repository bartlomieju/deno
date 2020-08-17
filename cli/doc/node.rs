// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind", content = "def")]
pub enum DocNodeKind {
  Function(super::function::FunctionDef),
  Variable(super::variable::VariableDef),
  Class(super::class::ClassDef),
  Enum(super::r#enum::EnumDef),
  Interface(super::interface::InterfaceDef),
  TypeAlias(super::type_alias::TypeAliasDef),
  Namespace(super::namespace::NamespaceDef),
  Import(ImportDef),
}


#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Location {
  pub filename: String,
  pub line: usize,
  pub col: usize,
}

impl Into<Location> for swc_common::Loc {
  fn into(self) -> Location {
    use swc_common::FileName::*;

    let filename = match &self.file.name {
      Real(path_buf) => path_buf.to_string_lossy().to_string(),
      Custom(str_) => str_.to_string(),
      _ => panic!("invalid filename"),
    };

    Location {
      filename,
      line: self.line,
      col: self.col_display,
    }
  }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum ReexportKind {
  /// export * from "./path/to/module.js";
  All,
  /// export * as someNamespace from "./path/to/module.js";
  Namespace(String),
  /// export default from "./path/to/module.js";
  Default,
  /// (identifier, optional alias)
  /// export { foo } from "./path/to/module.js";
  /// export { foo as bar } from "./path/to/module.js";
  Named(String, Option<String>),
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Reexport {
  pub kind: ReexportKind,
  pub src: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDoc {
  pub definitions: Vec<DocNode>,
  pub reexports: Vec<Reexport>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportDef {
  pub src: String,
  pub imported: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocNode {
  pub kind: DocNodeKind,
  pub name: String,
  pub location: Location,
  pub js_doc: Option<String>,
}

impl DocNode {
  pub fn function(
    name: String,
    location: Location,
    js_doc: Option<String>,
    fn_def: super::function::FunctionDef,
  ) -> Self {
    Self {
      kind: DocNodeKind::Function(fn_def),
      name,
      location,
      js_doc,
    }
  }

  pub fn variable(
    name: String,
    location: Location,
    js_doc: Option<String>,
    var_def: super::variable::VariableDef,
  ) -> Self {
    Self {
      kind: DocNodeKind::Variable(var_def),
      name,
      location,
      js_doc,
    }
  }

  pub fn r#enum(
    name: String,
    location: Location,
    js_doc: Option<String>,
    enum_def: super::r#enum::EnumDef,
  ) -> Self {
    Self {
      kind: DocNodeKind::Enum(enum_def),
      name,
      location,
      js_doc,
    }
  }

  pub fn class(
    name: String,
    location: Location,
    js_doc: Option<String>,
    class_def: super::class::ClassDef,
  ) -> Self {
    Self {
      kind: DocNodeKind::Class(class_def),
      name,
      location,
      js_doc,
    }
  }

  pub fn type_alias(
    name: String,
    location: Location,
    js_doc: Option<String>,
    type_alias_def: super::type_alias::TypeAliasDef,
  ) -> Self {
    Self {
      kind: DocNodeKind::TypeAlias(type_alias_def),
      name,
      location,
      js_doc,
    }
  }

  pub fn namespace(
    name: String,
    location: Location,
    js_doc: Option<String>,
    namespace_def: super::namespace::NamespaceDef,
  ) -> Self {
    Self {
      kind: DocNodeKind::Namespace(namespace_def),
      name,
      location,
      js_doc,
    }
  }

  pub fn interface(
    name: String,
    location: Location,
    js_doc: Option<String>,
    interface_def: super::interface::InterfaceDef,
  ) -> Self {
    Self {
      kind: DocNodeKind::Interface(interface_def),
      name,
      location,
      js_doc,
    }
  }

  pub fn import(
    name: String,
    location: Location,
    js_doc: Option<String>,
    import_def: ImportDef,
  ) -> Self {
    Self {
      kind: DocNodeKind::Import(import_def),
      name,
      location,
      js_doc,
    }
  }
}
