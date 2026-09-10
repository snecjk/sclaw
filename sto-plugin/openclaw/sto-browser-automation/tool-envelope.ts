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

export function envelopeFromExecuteResult(
	resultType: string,
	domain: string,
	data: unknown,
): StoToolEnvelope {
	if (data && typeof data === "object" && (data as { success?: unknown }).success === false) {
		const rec = data as { error?: unknown; message?: unknown };
		const message = typeof rec.error === "string"
			? rec.error
			: typeof rec.message === "string"
				? rec.message
				: "tool returned success:false";
		return {
			type: resultType,
			success: false,
			domain,
			data,
			message,
			error: { code: "sto_tool_error", message },
		};
	}
	return {
		type: resultType,
		success: true,
		domain,
		data,
	};
}

export function toolResultFromEnvelope(envelope: StoToolEnvelope) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
		details: envelope,
		isError: envelope.success === false,
	};
}
