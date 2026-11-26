// A dialog listing one worker's records that one rule failed in the selected period, newest
// first, so that a programme manager can see what the worker got wrong and coach them: each
// record's visit date, what was wrong with it as DQS's rule worded it, and a link that opens
// the record in Avni, where the patient and the form can be seen. DQS holds no patient identity,
// so Avni is where a record is recognised.
//
// The list is DQS's failed-records route, ten to a page. A record loaded before DQS kept the
// reason shows that the reason is not available yet. The footer opens the rule in Quality
// Dimensions, where every worker who failed it is listed.

import {
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Pagination,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useEffect, useState } from "react";
import { dqsApi } from "../api/client";
import { dayMonth, int, periodLabel, shortId } from "../format";
import { useDashboard, useLoad } from "../state";
import { DQ } from "../tokens";
import { Pending, TABLE_SX } from "./ui";

const PAGE_SIZE = 10;

export interface FailedRecordsTarget {
  ruleId: string;
  workerId: string;
  workerName: string;
  // The worker-period row's peer group as the URL carries it, or null for all of the
  // worker's records.
  group: string | null;
}

export function FailedRecords({ target, onClose, onRule }: {
  target: FailedRecordsTarget | null;
  onClose: () => void;
  // Opens the rule in Quality Dimensions.
  onRule: (ruleId: string) => void;
}) {
  // The last target is kept while the dialog fades out, so that it does not empty first.
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (target) setShown(target);
  }, [target]);
  return (
    <Dialog open={target != null} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="failed-records-title"
      slotProps={{ transition: { onExited: () => setShown(null) } }}>
      {shown && <Body target={shown} onClose={onClose} onRule={onRule} />}
    </Dialog>
  );
}

function Body({ target, onClose, onRule }: {
  target: FailedRecordsTarget;
  onClose: () => void;
  onRule: (ruleId: string) => void;
}) {
  const { grain, span, context, rules } = useDashboard();
  const [page, setPage] = useState(1);
  const start = span?.start ?? "";
  const found = useLoad(
    () =>
      dqsApi.failedRecords(grain, start, target.ruleId, target.workerId, {
        peerGroupKey: target.group,
        page,
        pageSize: PAGE_SIZE,
      }),
    [grain, start, target.ruleId, target.workerId, target.group, page],
    !!span,
  );
  const title = rules[target.ruleId]?.title || target.ruleId;
  return (
    <>
      <DialogTitle id="failed-records-title" sx={{ pr: 6 }}>
        <Typography component="span" sx={{ display: "block", fontSize: 20, fontWeight: 400 }}>{title}</Typography>
        <Typography component="span" variant="caption" sx={{ color: DQ.textMuted }}>
          {target.workerName} · {span ? periodLabel(grain, span) : ""} · {shortId(target.ruleId)}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Pending loaded={found} reserve={{ minHeight: 320 }} empty={`No records in ${span ? periodLabel(grain, span) : "this period"}.`}>
          {(result) =>
            result.records.length ? (
              <Stack spacing={1.5}>
                <Typography variant="body2" sx={{ color: DQ.textMuted }}>
                  {int(result.total)} record{result.total === 1 ? "" : "s"} failed this check. Open one in Avni to see the
                  patient and the form.
                </Typography>
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small" sx={TABLE_SX}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Visit</TableCell>
                        <TableCell>What was wrong</TableCell>
                        <TableCell align="right">In Avni</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {result.records.map((record) => (
                        <TableRow key={record.record_id}>
                          <TableCell sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{dayMonth(record.visit_date)}</TableCell>
                          <TableCell sx={{ verticalAlign: "top" }}>
                            {record.record_type === context.photo_record_type && (
                              <Chip size="small" label="Photo" sx={{ mr: 1, height: 20, bgcolor: DQ.surfaceMuted }} />
                            )}
                            {record.message ?? (
                              <Box component="span" sx={{ color: DQ.textSubtle }}>
                                The reason is not available for this record yet.
                              </Box>
                            )}
                          </TableCell>
                          <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                            {record.link ? (
                              <Link href={record.link} target="_blank" rel="noopener noreferrer"
                                sx={{ color: DQ.link, display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                Open {record.record_type === context.photo_record_type ? "screening" : "record"}
                                <OpenInNewIcon sx={{ fontSize: 14 }} />
                              </Link>
                            ) : (
                              <Box component="span" sx={{ color: DQ.textDisabled }}>—</Box>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                {result.total > PAGE_SIZE && (
                  <Pagination size="small" page={page} count={Math.ceil(result.total / PAGE_SIZE)}
                    onChange={(_, next) => setPage(next)} sx={{ alignSelf: "flex-end" }} />
                )}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ color: DQ.textSubtle }}>
                No record of this worker failed this check in this period.
              </Typography>
            )
          }
        </Pending>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3 }}>
        <Link component="button" variant="body2" onClick={() => onRule(target.ruleId)} sx={{ color: DQ.link }}>
          See every worker who failed this check
        </Link>
        <Link component="button" variant="body2" onClick={onClose} sx={{ color: DQ.textMuted }}>
          Close
        </Link>
      </DialogActions>
    </>
  );
}
