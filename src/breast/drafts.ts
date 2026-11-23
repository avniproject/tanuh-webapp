// A clinician's unfinished form, kept in this browser only. Avni has no server-side draft, so a
// draft does not follow the clinician to another computer. It is scoped to the organisation and
// the clinician, dropped when the form is submitted, and all drafts are dropped on sign-out.
// Closing the browser or a session running out does not drop them: the same clinician signing in
// again finds them, and so would anyone else using that browser profile with that login.
import type { Answers } from "@/forms/engine/answers";
import { isBlank } from "@/forms/engine/answers";
import type { ClinicianFormKey } from "./breastConcepts";
import { draftMark } from "./breastList";

const PREFIX = "breast-draft|";

export interface DraftScope {
  orgId: number | undefined;
  userUuid: string;
}

export interface Draft {
  answers: Answers;
  savedAt: string;
}

const scopePrefix = (scope: DraftScope): string => `${PREFIX}${scope.orgId ?? "org"}|${scope.userUuid}|`;
const key = (scope: DraftScope, screeningUuid: string, form: ClinicianFormKey): string =>
  `${scopePrefix(scope)}${draftMark(screeningUuid, form)}`;

function hasAnswer(answers: Answers): boolean {
  return Object.values(answers).some((v) => {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      return (v as Array<Record<string, unknown>>).some((row) => Object.values(row).some((f) => !isBlank(f)));
    }
    return !isBlank(v);
  });
}

export function saveDraft(
  storage: Storage,
  scope: DraftScope,
  screeningUuid: string,
  form: ClinicianFormKey,
  answers: Answers,
): boolean {
  const k = key(scope, screeningUuid, form);
  try {
    if (!hasAnswer(answers)) {
      storage.removeItem(k);
      return false;
    }
    const draft: Draft = { answers, savedAt: new Date().toISOString() };
    storage.setItem(k, JSON.stringify(draft));
    return true;
  } catch {
    // Storage full or switched off: the form still works, it just is not kept across a reload.
    return false;
  }
}

export function loadDraft(
  storage: Storage,
  scope: DraftScope,
  screeningUuid: string,
  form: ClinicianFormKey,
): Draft | null {
  try {
    const raw = storage.getItem(key(scope, screeningUuid, form));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    return draft && typeof draft.answers === "object" && draft.answers ? draft : null;
  } catch {
    return null;
  }
}

export function deleteDraft(storage: Storage, scope: DraftScope, screeningUuid: string, form: ClinicianFormKey): void {
  try {
    storage.removeItem(key(scope, screeningUuid, form));
  } catch {
    // nothing to remove
  }
}

function keysWith(storage: Storage, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  return keys;
}

/** The drafts this clinician has here, as `<screening uuid>|<form>` marks for the worklist. */
export function draftMarks(storage: Storage, scope: DraftScope): Set<string> {
  const prefix = scopePrefix(scope);
  try {
    return new Set(keysWith(storage, prefix).map((k) => k.slice(prefix.length)));
  } catch {
    return new Set();
  }
}

/** Every clinician's drafts in this browser: called on sign-out. */
export function clearDrafts(storage: Storage): void {
  try {
    keysWith(storage, PREFIX).forEach((k) => storage.removeItem(k));
  } catch {
    // nothing to clear
  }
}
