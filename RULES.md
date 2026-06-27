# Project Architectural Rules

## 1. Single Responsibility Principle
Every source file must contain exactly **one** discrete feature or core mathematical/UI functionality. Data transformation pipelines, graph routing engines, and rendering layers must live in independent modules.

## 2. File Length Limit
No file shall exceed **600 lines**. Modules approaching this limit must be split into sub-components or distinct strategy classes.

## 3. Modular Design & Encapsulation
- **TypeScript**: Strongly typed OOP.
- **Rust**: Modular data-oriented structs/traits.
- **State mutation**: Exclusively through explicit public methods (`killNode()`, `calculateRoute()`). Direct external property mutation is prohibited.
- **Interfaces**: Define explicit interfaces for Routing Engine, Physics Engine, and Translation pipeline to decouple from orchestration.

## 4. No Stubs or Mocks
No code stubs, mock responses, placeholder text, or TODO bypasses. Every path — from JSON ingestion through coordinate scaling, shortest-path, character translation, and UI rendering — must execute live computational logic.

## 5. Strict Decoupling (Rust ↔ TypeScript)
The Rust/WASM engine and TypeScript visualizer must remain strictly isolated. Communication occurs exclusively across strongly typed serializable boundaries managed by explicit WebAssembly bindings (`wasm-bindgen`). No shared state.

## 6. Bun.js Runtime Only
The TypeScript/UI package (`ui-wrapper/`) uses **Bun.js** exclusively. No Node.js. All commands use `bun` — `bun install`, `bun run dev`, etc. Ensure `bun` is installed and available.
