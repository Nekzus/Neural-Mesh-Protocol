import { z } from "zod";

/**
 * Base Protocol Types representing parity with Model Context Protocol
 */

export const ToolSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	inputSchema: z.record(z.string(), z.unknown()), // Represents a JSON Schema
});

export type Tool = z.infer<typeof ToolSchema>;

export const ResourceSchema = z.object({
	uri: z.string(),
	name: z.string(),
	description: z.string().optional(),
	mimeType: z.string().optional(),
});

export type Resource = z.infer<typeof ResourceSchema>;

export const PromptSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	arguments: z
		.array(
			z.object({
				name: z.string(),
				description: z.string().optional(),
				required: z.boolean().optional(),
			}),
		)
		.optional(),
});

export type Prompt = z.infer<typeof PromptSchema>;

export interface CallToolRequest {
	name: string;
	arguments?: Record<string, unknown>;
}

export interface CallToolResult {
	content: Array<{
		type: "text" | "image" | "resource";
		text?: string;
		data?: string;
		mimeType?: string;
		resource?: {
			uri: string;
			text?: string;
			blob?: string;
		};
	}>;
	isError?: boolean;
}

export interface GetPromptRequest {
	name: string;
	arguments?: Record<string, string>;
}

export interface GetPromptResult {
	description?: string;
	messages: Array<{
		role: "user" | "assistant";
		content:
			| { type: "text"; text: string }
			| { type: "image"; data: string; mimeType: string }
			| {
					type: "resource";
					resource: { uri: string; text?: string; blob?: string };
			  };
	}>;
}

export interface ServerInfo {
	name: string;
	version: string;
}
