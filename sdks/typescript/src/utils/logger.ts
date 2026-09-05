// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

/**
 * LiopLogger - Structured Logging Abstraction
 * Configurable via `process.env.LIOP_LOG_LEVEL`.
 * Emits strictly to stderr to comply with MCP stdio protocols.
 */
export class LiopLogger {
	private static instance: LiopLogger;
	private level: LogLevel = "info";

	private constructor() {
		this.setLevelFromEnv();
	}

	public static getInstance(): LiopLogger {
		if (!LiopLogger.instance) {
			LiopLogger.instance = new LiopLogger();
		}
		return LiopLogger.instance;
	}

	private setLevelFromEnv() {
		const envLevel = process.env.LIOP_LOG_LEVEL?.toLowerCase();
		if (
			envLevel === "silent" ||
			envLevel === "error" ||
			envLevel === "warn" ||
			envLevel === "info" ||
			envLevel === "debug"
		) {
			this.level = envLevel as LogLevel;
		} else {
			// Default level: info
			this.level = "info";
		}
	}

	public setLevel(level: LogLevel) {
		this.level = level;
	}

	private shouldLog(targetLevel: LogLevel): boolean {
		const levels: Record<LogLevel, number> = {
			silent: 0,
			error: 1,
			warn: 2,
			info: 3,
			debug: 4,
		};
		return levels[this.level] >= levels[targetLevel];
	}

	private formatMessage(level: string, message: string): string {
		const ts = new Date().toISOString();
		return `[${ts}] [${level}] ${message}`;
	}

	public error(message: string, ...args: unknown[]) {
		if (this.shouldLog("error")) {
			console.error(this.formatMessage("ERROR", message), ...args);
		}
	}

	public warn(message: string, ...args: unknown[]) {
		if (this.shouldLog("warn")) {
			console.error(this.formatMessage("WARN", message), ...args);
		}
	}

	public info(message: string, ...args: unknown[]) {
		if (this.shouldLog("info")) {
			console.error(this.formatMessage("INFO", message), ...args);
		}
	}

	public debug(message: string, ...args: unknown[]) {
		if (this.shouldLog("debug")) {
			console.error(this.formatMessage("DEBUG", message), ...args);
		}
	}
}

export const log = LiopLogger.getInstance();
