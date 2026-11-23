import { Box, ButtonBase, CircularProgress, InputBase, Stack, Typography } from "@mui/material";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/authContext";
import { filterCases, pendingCount, type BreastCase, type CaseFilter } from "@/breast/breastList";
import { loadBreastCases } from "@/breast/loadBreastCases";
import { Card, FormStatusPill, PillButton, RiskPill } from "@/breast/ui";
import { useAsync } from "@/hooks/useAsync";
import { CR, crText } from "@/theme/tokens";

const FILTERS: Array<{ key: CaseFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "awaiting", label: "Awaiting assessment" },
  { key: "assessed", label: "Assessed" },
];

const COLUMNS = ["Subject ID", "Screened on", "Age", "AI risk", "Referral", "Additional assessment", "Clinician assessment", ""];

const cell = {
  px: 2,
  py: 1.75,
  fontFamily: CR.font,
  fontSize: 14,
  color: CR.textTertiary,
  textAlign: "left",
  borderTop: `1px solid ${CR.divider}`,
  verticalAlign: "middle",
} as const;

function referral(c: BreastCase): string {
  return c.hospital ? `${c.hospital} · ${c.reason}` : c.reason;
}

export function BreastListPage() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<CaseFilter>("all");
  const [search, setSearch] = useState("");
  const [hospital, setHospital] = useState("");
  const user = state.status === "ready" ? state.user : null;
  const { data, error, loading } = useAsync(
    () => loadBreastCases({ orgId: user?.organisationId, userUuid: user?.userUUID ?? "" }),
    [user?.userUUID],
  );
  const hospitals = useMemo(
    () => [...new Set((data ?? []).map((c) => c.hospital).filter((h): h is string => !!h))].sort(),
    [data],
  );
  const rows = useMemo(
    () => filterCases(data ?? [], filter, search).filter((c) => !hospital || c.hospital === hospital),
    [data, filter, search, hospital],
  );
  const open = (c: BreastCase) => navigate(`/breast/woman/${c.screeningUuid}`);

  return (
    <Box sx={{ ...crText, maxWidth: 1280, mx: "auto" }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems={{ md: "flex-start" }}
        justifyContent="space-between"
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography component="h1" sx={{ fontFamily: CR.font, fontSize: 28, fontWeight: 600, color: CR.heading }}>
            Breast Cancer Screening
          </Typography>
          <Typography sx={{ fontFamily: CR.font, fontSize: 15, color: CR.textSecondary }}>
            Women referred by FLWs for hospital assessment
            {data ? ` · ${data.length} referred · ${pendingCount(data)} awaiting assessment` : ""}
          </Typography>
        </Box>
        <InputBase
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by Subject ID or hospital"
          inputProps={{ "aria-label": "Search by Subject ID or hospital" }}
          sx={{
            width: { xs: "100%", md: 360 },
            height: 46,
            px: 2.5,
            bgcolor: CR.surface,
            border: `1px solid ${CR.inputBorder}`,
            borderRadius: CR.radius.pill,
            fontFamily: CR.font,
            fontSize: 14,
            "&.Mui-focused": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
          }}
        />
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: "wrap", rowGap: 1.5 }}>
      <Box
        role="tablist"
        aria-label="Filter the list"
        sx={{ display: "inline-flex", p: 0.5, bgcolor: CR.segment, borderRadius: CR.radius.pill, flexWrap: "wrap" }}
      >
        {FILTERS.map((f) => (
          <ButtonBase
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            sx={{
              px: 2.25,
              height: 36,
              borderRadius: CR.radius.pill,
              fontFamily: CR.font,
              fontSize: 14,
              fontWeight: filter === f.key ? 600 : 500,
              color: CR.text,
              bgcolor: filter === f.key ? CR.surface : "transparent",
              "&:focus-visible": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
            }}
          >
            {f.label}
          </ButtonBase>
        ))}
      </Box>
      {hospitals.length > 0 && (
        <Box
          component="select"
          value={hospital}
          aria-label="Filter by hospital"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setHospital(e.target.value)}
          sx={{
            height: 44,
            px: 2,
            bgcolor: CR.surface,
            border: `1px solid ${CR.inputBorder}`,
            borderRadius: CR.radius.pill,
            fontFamily: CR.font,
            fontSize: 14,
            color: CR.text,
            maxWidth: 320,
            "&:focus-visible": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
          }}
        >
          <option value="">All hospitals</option>
          {hospitals.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Box>
      )}
      </Stack>

      <Card>
        {loading && (
          <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
            <CircularProgress sx={{ color: CR.brand }} />
          </Box>
        )}
        {error && (
          <Box sx={{ p: 3, color: CR.error, bgcolor: CR.errorSubtle, fontFamily: CR.font }}>
            The list could not be loaded: {error}. Reload to try again.
          </Box>
        )}
        {data && rows.length === 0 && (
          <Box sx={{ p: 5, textAlign: "center", fontFamily: CR.font, color: CR.textSecondary }}>
            {data.length === 0 ? "No woman has been referred yet." : "No woman matches this filter."}
          </Box>
        )}
        {data && rows.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <Box component="thead" sx={{ bgcolor: CR.tableHead }}>
                <tr>
                  {COLUMNS.map((c) => (
                    <Box
                      component="th"
                      key={c}
                      scope="col"
                      sx={{ ...cell, borderTop: "none", fontWeight: 600, color: CR.text, whiteSpace: "nowrap" }}
                    >
                      {c}
                    </Box>
                  ))}
                </tr>
              </Box>
              <tbody>
                {rows.map((c) => (
                  <Box
                    component="tr"
                    key={c.screeningUuid}
                    onClick={() => open(c)}
                    sx={{ cursor: "pointer", "&:hover": { bgcolor: CR.hover } }}
                  >
                    <Box component="td" sx={{ ...cell, fontWeight: 700, color: CR.text }}>
                      {c.subjectId}
                    </Box>
                    <Box component="td" sx={{ ...cell, whiteSpace: "nowrap" }}>
                      {format(new Date(c.screenedOn), "d MMM yyyy")}
                    </Box>
                    <Box component="td" sx={cell}>
                      {c.age ?? "–"}
                    </Box>
                    <Box component="td" sx={cell}>
                      <RiskPill risk={c.risk} />
                    </Box>
                    <Box component="td" sx={cell}>
                      {referral(c)}
                    </Box>
                    <Box component="td" sx={cell}>
                      <FormStatusPill status={c.assessment} />
                    </Box>
                    <Box component="td" sx={cell}>
                      <FormStatusPill status={c.clinician} />
                    </Box>
                    <Box component="td" sx={{ ...cell, textAlign: "right" }}>
                      <PillButton onClick={() => open(c)}>Open</PillButton>
                    </Box>
                  </Box>
                ))}
              </tbody>
            </Box>
          </Box>
        )}
      </Card>
    </Box>
  );
}
