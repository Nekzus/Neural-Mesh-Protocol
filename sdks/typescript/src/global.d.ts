// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

// Global type declarations for modern ES features not yet in all ambient types
interface PromiseWithResolvers<T> {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
}

interface PromiseConstructor {
	/**
	 * Creates a new Promise and returns it in an object, along with its resolve and reject functions.
	 * @returns An object with the new promise and its resolve and reject functions.
	 */
	withResolvers<T>(): PromiseWithResolvers<T>;
}
