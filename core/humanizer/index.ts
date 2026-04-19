const { mergeConfig, shouldProcess, runAdaptiveHumanizer } = require("./core.js");

export default function register(api: any) {
  const cfg = mergeConfig((api.pluginConfig ?? {}) as Record<string, unknown>);

  api.on("message_sending", async (event: any, ctx: any) => {
    const content = String(event?.content ?? "");
    if (!content) return;

    const gate = shouldProcess(content, cfg, {
      channelId: String(ctx?.channelId || ""),
      to: String(event?.to || "")
    });

    if (!gate.ok) {
      if (cfg.debug) {
        api.logger.info?.(`humanizer: skip (${gate.reason})`);
      }
      return;
    }

    const result = await runAdaptiveHumanizer(content, cfg);

    if (cfg.debug) {
      api.logger.info?.(
        `humanizer: source=${result.source || "unknown"} changed=${Boolean(result.changed)} blocked=${result.blocked || "none"}`,
      );
    }

    if (!result.changed) return;
    return { content: String(result.text || content) };
  });
}
