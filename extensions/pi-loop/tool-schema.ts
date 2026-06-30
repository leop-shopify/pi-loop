import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const FeedbackStatusSchema = StringEnum(["continue", "blocked", "ready_for_review"] as const);
const AcceptanceStatusSchema = StringEnum(["missing", "discovering", "proposed", "confirmed"] as const);
const PlanTaskStatusSchema = StringEnum(["pending", "in_progress", "completed", "blocked"] as const);
const NonEmptyTextSchema = Type.String({ minLength: 1 });

const PlanTaskSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, description: "Stable task id such as AC1, T1, or verify-tests." })),
  title: NonEmptyTextSchema,
  status: PlanTaskStatusSchema,
  evidence: Type.Optional(Type.String({ minLength: 1, description: "Evidence, blocker, or handoff note for this task." })),
}, { additionalProperties: false });

export const LoopFeedbackParams = Type.Object({
  summary: Type.Optional(Type.String({ description: "Concise human summary of the turn. Omit when the transcript already says enough." })),
  status: Type.Optional(FeedbackStatusSchema),
  notes: Type.Optional(Type.String({ description: "Optional blocker, handoff, or next-step note. Do not restate full verification evidence." })),
  acceptanceStatus: Type.Optional(AcceptanceStatusSchema),
  acceptanceCriteria: Type.Optional(Type.Array(NonEmptyTextSchema, { description: "Observable criteria or candidate criteria being discovered with the user." })),
  planTasks: Type.Optional(Type.Array(PlanTaskSchema, { description: "Current trackable loop plan tasks. Statuses drive the next refined prompt after criteria are confirmed." })),
  nextActions: Type.Optional(Type.Array(Type.String(), { description: "Optional short next actions for the refinement prompt." })),
}, { additionalProperties: false });
