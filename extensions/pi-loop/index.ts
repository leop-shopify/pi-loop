import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { FEEDBACK_TOOL_NAME } from "./constants.ts";
import { createLoopController } from "./controller.ts";
import { registerLoopCommand } from "./loop-command.ts";
import { registerLoopEvents } from "./events.ts";
import { createRuntimeStore } from "./runtime-store.ts";
import { registerScoreTool } from "./score-tool.ts";

export default function piLoopExtension(pi: ExtensionAPI) {
  const store = createRuntimeStore();
  const controller = createLoopController(pi, store, FEEDBACK_TOOL_NAME);

  registerScoreTool(pi, controller);
  registerLoopEvents(pi, controller);
  registerLoopCommand(pi, controller);
}
