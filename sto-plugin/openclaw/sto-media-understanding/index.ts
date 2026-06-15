import { requireOpenClawPluginSdk } from "./openclaw-sdk.js";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

const { describeImageWithModel, describeImagesWithModel } =
	requireOpenClawPluginSdk<typeof import("openclaw/plugin-sdk/media-understanding")>(
		"media-understanding",
	);

const TAG = "sto-media-understanding";
/** Must match models.providers.sto and imageModel refs like sto/qwen3.7-max */
const STO_MEDIA_PROVIDER_ID = "sto";

export default definePluginEntry({
	id: "sto-media-understanding",
	name: "STO 图片理解",
	description:
		"Registers sto as an OpenClaw media-understanding provider for the built-in image tool.",
	register(api: OpenClawPluginApi) {
		api.registerMediaUnderstandingProvider({
			id: STO_MEDIA_PROVIDER_ID,
			capabilities: ["image"],
			describeImage: describeImageWithModel,
			describeImages: describeImagesWithModel,
		});
		api.logger.info?.(
			`[${TAG}] registered media-understanding provider id=${STO_MEDIA_PROVIDER_ID}`,
		);
	},
});
