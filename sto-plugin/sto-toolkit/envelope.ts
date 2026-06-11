export interface StoToolError {
	code: string;
	message: string;
}

export interface StoToolEnvelope<T = unknown> {
	type: string;
	success: boolean;
	domain: string;
	message?: string;
	data?: T;
	error?: StoToolError;
}

export function stoToolSuccess<T>(
	type: string,
	domain: string,
	data: T,
	message?: string,
): StoToolEnvelope<T> {
	return {
		type,
		success: true,
		domain,
		message,
		data,
	};
}

export function stoToolError(
	domain: string,
	message: string,
	code = "sto_tool_error",
): StoToolEnvelope {
	return {
		type: "sto_tool_error",
		success: false,
		domain,
		message,
		error: { code, message },
	};
}

export function toolResultFromEnvelope(envelope: StoToolEnvelope) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
		details: envelope,
	};
}
