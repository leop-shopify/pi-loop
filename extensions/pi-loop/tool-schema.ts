import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const FeedbackStatusSchema = StringEnum(["continue", "blocked", "ready_for_review"] as const);
const AcceptanceStatusSchema = StringEnum(["missing", "discovering", "proposed", "confirmed"] as const);
const PlanTaskStatusSchema = StringEnum(["pending", "in_progress", "completed", "blocked"] as const);
const NonEmptyTextSchema = Type.String({ minLength: 1 });

const MeasuredMetricSchema = Type.Object({
  name: NonEmptyTextSchema,
  value: Type.Number({ description: "Measured numeric value from a real command run this turn." }),
  unit: Type.Optional(Type.String({ description: "Unit such as %, ms, s, kb." })),
  sourceCommand: Type.Optional(Type.String({ description: "The command that produced this value this turn, recorded as provenance. Verification is by the value itself: metrics whose value does not appear in tool output observed this turn are labeled unverified." })),
}, { additionalProperties: false });

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
  metrics: Type.Optional(Type.Array(MeasuredMetricSchema, { description: "Measured values for the loop's numeric objectives (use the objective id like O1 as the name when one matches). Only report numbers produced by real commands this turn." })),
  hypothesis: Type.Optional(Type.String({ minLength: 1, description: "One-line hypothesis this turn tested, e.g. 'parallelizing the suite cuts runtime'." })),
  verdict: Type.Optional(StringEnum(["keep", "discard"] as const)),
  nextActions: Type.Optional(Type.Array(Type.String(), { description: "Optional short next actions for the refinement prompt." })),
}, { additionalProperties: false });
