import { http } from "@/auth/httpClient";
import type { SubjectApiResponse } from "./types";

export async function getSubject(uuid: string): Promise<SubjectApiResponse> {
  const response = await http.get<SubjectApiResponse>(`/api/subject/${uuid}`);
  return response.data;
}
