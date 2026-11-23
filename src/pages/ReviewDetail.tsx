import { Box, Typography } from "@mui/material";
import { useParams, useNavigate } from "react-router-dom";
import { ReviewForm } from "@/forms/ReviewForm";

export function ReviewDetail() {
  const { encounterUuid } = useParams<{ encounterUuid: string }>();
  const navigate = useNavigate();

  if (!encounterUuid) {
    return <Typography color="error">No encounter id in URL</Typography>;
  }

  return (
    <Box>
      {/* Keyed by the case, so moving from one case to another starts a fresh form, with its own draft (FW4). */}
      <ReviewForm key={encounterUuid} encounterUuid={encounterUuid} onBack={() => navigate(-1)} />
    </Box>
  );
}
