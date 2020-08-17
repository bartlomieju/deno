// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

// TODO(ry) This module builds up output by appending to a string. Instead it
// should either use a formatting trait
// https://doc.rust-lang.org/std/fmt/index.html#formatting-traits
// Or perhaps implement a Serializer for serde
// https://docs.serde.rs/serde/ser/trait.Serializer.html

// TODO(ry) The methods in this module take ownership of the DocNodes, this is
// unnecessary and can result in unnecessary copying. Instead they should take
// references.

use crate::colors;
use crate::doc;
use crate::doc::display::{
  display_abstract, display_async, display_generator, Indent, SliceDisplayer,
};
use crate::doc::DocNodeKind;
use std::fmt::{Display, Formatter, Result as FmtResult};

pub struct DocPrinter<'a> {
  doc_nodes: &'a [doc::DocNode],
  private: bool,
}

impl<'a> DocPrinter<'a> {
  pub fn new(doc_nodes: &[doc::DocNode], private: bool) -> DocPrinter {
    DocPrinter { doc_nodes, private }
  }

  pub fn format(&self, w: &mut Formatter<'_>) -> FmtResult {
    self.format_(w, self.doc_nodes, 0)
  }

  fn format_(
    &self,
    w: &mut Formatter<'_>,
    doc_nodes: &[doc::DocNode],
    indent: i64,
  ) -> FmtResult {
    let mut sorted = Vec::from(doc_nodes);
    sorted.sort_unstable_by(|a, b| {
      let kind_cmp = self.kind_order(&a.kind).cmp(&self.kind_order(&b.kind));
      if kind_cmp == core::cmp::Ordering::Equal {
        a.name.cmp(&b.name)
      } else {
        kind_cmp
      }
    });

    for node in &sorted {
      write!(
        w,
        "{}",
        colors::italic_gray(&format!(
          "Defined in {}:{}:{} \n\n",
          node.location.filename, node.location.line, node.location.col
        ))
      )?;

      self.format_signature(w, &node, indent)?;

      let js_doc = &node.js_doc;
      if let Some(js_doc) = js_doc {
        self.format_jsdoc(w, js_doc, indent + 1)?;
      }
      writeln!(w)?;

      match node.kind {
        DocNodeKind::Class(_) => self.format_class(w, node)?,
        DocNodeKind::Enum(_) => self.format_enum(w, node)?,
        DocNodeKind::Interface(_) => self.format_interface(w, node)?,
        DocNodeKind::Namespace(_) => self.format_namespace(w, node)?,
        _ => {}
      }
    }

    Ok(())
  }

  fn kind_order(&self, kind: &doc::DocNodeKind) -> i64 {
    match kind {
      DocNodeKind::Function(_) => 0,
      DocNodeKind::Variable(_) => 1,
      DocNodeKind::Class(_) => 2,
      DocNodeKind::Enum(_) => 3,
      DocNodeKind::Interface(_) => 4,
      DocNodeKind::TypeAlias(_) => 5,
      DocNodeKind::Namespace(_) => 6,
      DocNodeKind::Import(_) => 7,
    }
  }

  fn format_signature(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
    indent: i64,
  ) -> FmtResult {
    match node.kind {
      DocNodeKind::Function(_) => self.format_function_signature(w, node, indent),
      DocNodeKind::Variable(_) => self.format_variable_signature(w, node, indent),
      DocNodeKind::Class(_) => self.format_class_signature(w, node, indent),
      DocNodeKind::Enum(_) => self.format_enum_signature(w, node, indent),
      DocNodeKind::Interface(_) => {
        self.format_interface_signature(w, node, indent)
      }
      DocNodeKind::TypeAlias(_) => {
        self.format_type_alias_signature(w, node, indent)
      }
      DocNodeKind::Namespace(_) => {
        self.format_namespace_signature(w, node, indent)
      }
      DocNodeKind::Import(_) => Ok(()),
    }
  }

  // TODO(SyrupThinker) this should use a JSDoc parser
  fn format_jsdoc(
    &self,
    w: &mut Formatter<'_>,
    jsdoc: &str,
    indent: i64,
  ) -> FmtResult {
    for line in jsdoc.lines() {
      writeln!(w, "{}{}", Indent(indent), colors::gray(&line))?;
    }

    Ok(())
  }

  fn format_class(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
  ) -> FmtResult {
    let class_def = match &node.kind {
      DocNodeKind::Class(class_def) => class_def,
      _ => unreachable!()
    };
    for node in &class_def.constructors {
      writeln!(w, "{}{}", Indent(1), node,)?;
      if let Some(js_doc) = &node.js_doc {
        self.format_jsdoc(w, &js_doc, 2)?;
      }
    }
    for node in class_def.properties.iter().filter(|node| {
      self.private
        || node
          .accessibility
          .unwrap_or(swc_ecmascript::ast::Accessibility::Public)
          != swc_ecmascript::ast::Accessibility::Private
    }) {
      writeln!(w, "{}{}", Indent(1), node,)?;
      if let Some(js_doc) = &node.js_doc {
        self.format_jsdoc(w, &js_doc, 2)?;
      }
    }
    for index_sign_def in &class_def.index_signatures {
      writeln!(w, "{}{}", Indent(1), index_sign_def)?;
    }
    for node in class_def.methods.iter().filter(|node| {
      self.private
        || node
          .accessibility
          .unwrap_or(swc_ecmascript::ast::Accessibility::Public)
          != swc_ecmascript::ast::Accessibility::Private
    }) {
      writeln!(w, "{}{}", Indent(1), node,)?;
      if let Some(js_doc) = &node.js_doc {
        self.format_jsdoc(w, js_doc, 2)?;
      }
    }
    writeln!(w)
  }

  fn format_enum(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
  ) -> FmtResult {
    let enum_def = match &node.kind {
      DocNodeKind::r#Enum(enum_def) => enum_def,
      _ => unreachable!(),
    };
    for member in &enum_def.members {
      writeln!(w, "{}{}", Indent(1), colors::bold(&member.name))?;
    }
    writeln!(w)
  }

  fn format_interface(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
  ) -> FmtResult {
    let interface_def = match &node.kind {
      DocNodeKind::Interface(interface_def) => interface_def,
      _ => unreachable!(),
    };
    for property_def in &interface_def.properties {
      writeln!(w, "{}{}", Indent(1), property_def)?;
      if let Some(js_doc) = &property_def.js_doc {
        self.format_jsdoc(w, js_doc, 2)?;
      }
    }
    for method_def in &interface_def.methods {
      writeln!(w, "{}{}", Indent(1), method_def)?;
      if let Some(js_doc) = &method_def.js_doc {
        self.format_jsdoc(w, js_doc, 2)?;
      }
    }
    for index_sign_def in &interface_def.index_signatures {
      writeln!(w, "{}{}", Indent(1), index_sign_def)?;
    }
    writeln!(w)
  }

  fn format_namespace(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
  ) -> FmtResult {
    let namespace_def = match &node.kind {
      DocNodeKind::Namespace(ns_def) => ns_def,
      _ => unreachable!(),
    };
    let elements = &namespace_def.elements;
    for node in elements {
      self.format_signature(w, &node, 1)?;
      if let Some(js_doc) = &node.js_doc {
        self.format_jsdoc(w, js_doc, 2)?;
      }
    }
    writeln!(w)
  }

  fn format_class_signature(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
    indent: i64,
  ) -> FmtResult {
    let class_def = match &node.kind {
      DocNodeKind::Class(class_def) => class_def,
      _ => unreachable!(),
    };
    write!(
      w,
      "{}{}{} {}",
      Indent(indent),
      display_abstract(class_def.is_abstract),
      colors::magenta("class"),
      colors::bold(&node.name),
    )?;
    if !class_def.type_params.is_empty() {
      write!(
        w,
        "<{}>",
        SliceDisplayer::new(&class_def.type_params, ", ", false)
      )?;
    }

    if let Some(extends) = &class_def.extends {
      write!(w, " {} {}", colors::magenta("extends"), extends)?;
    }
    if !class_def.super_type_params.is_empty() {
      write!(
        w,
        "<{}>",
        SliceDisplayer::new(&class_def.super_type_params, ", ", false)
      )?;
    }

    if !class_def.implements.is_empty() {
      write!(
        w,
        " {} {}",
        colors::magenta("implements"),
        SliceDisplayer::new(&class_def.implements, ", ", false)
      )?;
    }

    writeln!(w)
  }

  fn format_enum_signature(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
    indent: i64,
  ) -> FmtResult {
    writeln!(
      w,
      "{}{} {}",
      Indent(indent),
      colors::magenta("enum"),
      colors::bold(&node.name)
    )
  }

  fn format_function_signature(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
    indent: i64,
  ) -> FmtResult {
    let function_def = match &node.kind {
      DocNodeKind::Function(function_def) => function_def,
      _ => unreachable!(),
    };
    write!(
      w,
      "{}{}{}{} {}",
      Indent(indent),
      display_async(function_def.is_async),
      colors::magenta("function"),
      display_generator(function_def.is_generator),
      colors::bold(&node.name)
    )?;
    if !function_def.type_params.is_empty() {
      write!(
        w,
        "<{}>",
        SliceDisplayer::new(&function_def.type_params, ", ", false)
      )?;
    }
    write!(
      w,
      "({})",
      SliceDisplayer::new(&function_def.params, ", ", false)
    )?;
    if let Some(return_type) = &function_def.return_type {
      write!(w, ": {}", return_type)?;
    }
    writeln!(w)
  }

  fn format_interface_signature(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
    indent: i64,
  ) -> FmtResult {
    let interface_def = match &node.kind {
      DocNodeKind::Interface(i_def) => i_def,
      _ => unreachable!(),
    };
    write!(
      w,
      "{}{} {}",
      Indent(indent),
      colors::magenta("interface"),
      colors::bold(&node.name)
    )?;

    if !interface_def.type_params.is_empty() {
      write!(
        w,
        "<{}>",
        SliceDisplayer::new(&interface_def.type_params, ", ", false)
      )?;
    }

    if !interface_def.extends.is_empty() {
      write!(
        w,
        " {} {}",
        colors::magenta("extends"),
        SliceDisplayer::new(&interface_def.extends, ", ", false)
      )?;
    }

    writeln!(w)
  }

  fn format_type_alias_signature(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
    indent: i64,
  ) -> FmtResult {
    let type_alias_def = match &node.kind {
      DocNodeKind::TypeAlias(ta_def) => ta_def,
      _ => unreachable!(),
    };
    write!(
      w,
      "{}{} {}",
      Indent(indent),
      colors::magenta("type"),
      colors::bold(&node.name),
    )?;

    if !type_alias_def.type_params.is_empty() {
      write!(
        w,
        "<{}>",
        SliceDisplayer::new(&type_alias_def.type_params, ", ", false)
      )?;
    }

    writeln!(w, " = {}", type_alias_def.ts_type)
  }

  fn format_namespace_signature(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
    indent: i64,
  ) -> FmtResult {
    writeln!(
      w,
      "{}{} {}",
      Indent(indent),
      colors::magenta("namespace"),
      colors::bold(&node.name)
    )
  }

  fn format_variable_signature(
    &self,
    w: &mut Formatter<'_>,
    node: &doc::DocNode,
    indent: i64,
  ) -> FmtResult {
    let variable_def = match &node.kind {
      DocNodeKind::Variable(var_def) => var_def,
      _ => unreachable!(),
    };
    write!(
      w,
      "{}{} {}",
      Indent(indent),
      colors::magenta(match variable_def.kind {
        swc_ecmascript::ast::VarDeclKind::Const => "const",
        swc_ecmascript::ast::VarDeclKind::Let => "let",
        swc_ecmascript::ast::VarDeclKind::Var => "var",
      }),
      colors::bold(&node.name),
    )?;
    if let Some(ts_type) = &variable_def.ts_type {
      write!(w, ": {}", ts_type)?;
    }
    writeln!(w)
  }
}

impl<'a> Display for DocPrinter<'a> {
  fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
    self.format(f)
  }
}
