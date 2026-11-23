import { http } from "@/auth/httpClient";
import { parseForm, type FormDef } from "@/forms/engine/formDef";

// A form's definition, read from Avni each time the app is opened (GET /web/form/{uuid}, the call
// Avni's own data entry app makes). A change to the form in Avni shows here on the next reload,
// with no release of this app.
const cache = new Map<string, Promise<FormDef>>();

export function getFormDef(uuid: string): Promise<FormDef> {
  let hit = cache.get(uuid);
  if (!hit) {
    hit = http.get<unknown>(`/web/form/${uuid}`).then((r) => parseForm(r.data));
    hit.catch(() => cache.delete(uuid));
    cache.set(uuid, hit);
  }
  return hit;
}
