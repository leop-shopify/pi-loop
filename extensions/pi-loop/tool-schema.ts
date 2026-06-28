import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const FeedbackStatusSchema = StringEnum(["continue", "blocked", "ready_for_review"] as const);

export const LoopFeedbackParams = Type.Object({
  summary: Type.Optional(Type.String({ description: "Concise human summary of the turn. Omit when the transcript already says enough." })),
  status: Type.Optional(FeedbackStatusSchema),
  notes: Type.Optional(Type.String({ description: "Optional blocker, handoff, or next-step note. Do not restate full verification evidence." })),
  nextActions: Type.Optional(Type.Array(Type.String(), { description: "Optional short next actions for the refinement prompt." })),
}, { additionalProperties: false });
