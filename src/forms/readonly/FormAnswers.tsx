import { Box, Stack, Typography } from "@mui/material";
import type { Answers } from "@/forms/engine/answers";
import type { FormDef } from "@/forms/engine/formDef";
import { answeredSections } from "./answered";
import { CR } from "@/theme/tokens";

function Line({ label, text }: { label: string; text: string }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.25, sm: 2 }}
      sx={{ py: 1.1, borderTop: `1px solid ${CR.divider}` }}
    >
      <Typography sx={{ flex: "0 0 52%", fontFamily: CR.font, fontSize: 14, color: CR.textSecondary }}>{label}</Typography>
      <Typography sx={{ fontFamily: CR.font, fontSize: 14, fontWeight: 500, color: CR.text, overflowWrap: "anywhere" }}>
        {text}
      </Typography>
    </Stack>
  );
}

/** A visit's answers, read-only, laid out by the form's sections in Avni's order and wording. */
export function FormAnswers({ form, answers, skip }: { form: FormDef; answers: Answers; skip?: ReadonlySet<string> }) {
  const sections = answeredSections(form, answers, skip);
  if (sections.length === 0) {
    return (
      <Typography sx={{ fontFamily: CR.font, fontSize: 14, color: CR.textSecondary }}>No answers were recorded.</Typography>
    );
  }
  return (
    <Stack spacing={2.5}>
      {sections.map((section) => (
        <Box key={section.name}>
          <Typography component="h3" sx={{ mb: 0.5, fontFamily: CR.font, fontSize: 16, fontWeight: 600, color: CR.heading }}>
            {section.name}
          </Typography>
          {section.rows.map((row) =>
            "records" in row ? (
              <Box key={row.element.uuid} sx={{ py: 1.1, borderTop: `1px solid ${CR.divider}` }}>
                <Typography sx={{ fontFamily: CR.font, fontSize: 14, color: CR.textSecondary }}>{row.element.name}</Typography>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {row.records.map((record, i) => (
                    <Box key={i} sx={{ px: 2, pb: 0.5, border: `1px solid ${CR.border}`, borderRadius: CR.radius.panel, bgcolor: CR.hover }}>
                      <Typography sx={{ pt: 1, fontFamily: CR.font, fontSize: 12.5, fontWeight: 600, color: CR.textSecondary }}>
                        Record {i + 1}
                      </Typography>
                      {record.map((f) => (
                        <Line key={f.element.uuid} label={f.element.name} text={f.text} />
                      ))}
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : (
              <Line key={row.element.uuid} label={row.element.name} text={row.text} />
            ),
          )}
        </Box>
      ))}
    </Stack>
  );
}
