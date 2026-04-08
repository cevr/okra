import type { Effect } from "effect";
import { Ref } from "effect";

export interface RecordedCall {
  service: string;
  method: string;
  args: unknown;
  result?: unknown;
}

export interface ExpectedCall {
  service: string;
  method: string;
  match?: Record<string, unknown>;
}

export type SequenceRef = Ref.Ref<RecordedCall[]>;

export function createSequenceRef(): SequenceRef {
  return Ref.makeUnsafe<RecordedCall[]>([]);
}

export function recordCall(
  sequenceRef: SequenceRef,
  call: Omit<RecordedCall, "result"> & { result?: unknown },
): Effect.Effect<void> {
  return Ref.update(sequenceRef, (seq) => [...seq, call]);
}

export function getSequence(sequenceRef: SequenceRef): Effect.Effect<RecordedCall[]> {
  return Ref.get(sequenceRef);
}
