// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

// LIOP (Logic-Injection-on-Origin Protocol) Core Library
// Re-exports the generated tonic/prost types.

pub mod v1 {
    tonic::include_proto!("liop.v1");
}
